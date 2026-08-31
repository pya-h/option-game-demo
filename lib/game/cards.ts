/**
 * Card rules: minting, exercising, listing and acquiring.
 *
 * Everything here takes an explicit userId rather than reading a session. Authentication is a
 * transport concern and lives in app/actions, which is a thin wrapper over these functions.
 * Keeping the rules here means the simulation script can drive exactly the code a player does,
 * and — critically — these are NOT "use server" exports, so nothing here is reachable over the
 * wire without going through the authenticated wrapper.
 */
import type { PoolClient } from "pg";
import {
  ASSET_MAP,
  CFG,
  MATCH_EXPIRY_MARGIN_SECONDS,
  MAX_EXPIRY_SECONDS,
  MIN_EXPIRY_SECONDS,
  type AssetSymbol,
} from "@/lib/config";
import { fail, q, tx } from "@/lib/db";
import { duration } from "@/lib/fmt";
import { spendEnergy, touchActivity } from "@/lib/energy";
import { cardValue, collateralFor, exerciseCost, exercisePayout, quotePremium } from "@/lib/options";
import { getPrice } from "@/lib/prices";
import type { CardEventDTO } from "@/lib/types";
import { addXp, applyWallet, loadWallet } from "@/lib/wallet";
import { type Res, guard } from "./guard";


async function logEvent(
  c: PoolClient,
  cardId: number,
  type: string,
  o: {
    actor?: number | null;
    from?: number | null;
    to?: number | null;
    opt?: number;
    portfolio?: number;
    note?: string;
  } = {}
) {
  await c.query(
    `INSERT INTO card_events (card_id, type, actor_id, from_user_id, to_user_id, opt_delta, portfolio_delta, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [cardId, type, o.actor ?? null, o.from ?? null, o.to ?? null, o.opt ?? 0, o.portfolio ?? 0, o.note ?? null]
  );
}

/**
 * Validates a PvP match is running and the option resolves before the final whistle (§21).
 * Strictly before, not at: a card settling in the same instant the match finalises would be
 * ranked or not depending on which transaction landed first, and one that resolves after can
 * never pay out at all — so offering either would be a trap.
 */
async function assertMatchWindow(
  c: PoolClient,
  matchId: number,
  userId: number,
  seconds: number
) {
  const { rows } = await c.query(
    `SELECT status, ends_at FROM matches WHERE id = $1 FOR SHARE`,
    [matchId]
  );
  const m = rows[0];
  if (!m) fail("match not found");
  if (m.status !== "ACTIVE") fail("This match is not running");

  // Declined and never-answered players keep their match_players row, so loading a wallet
  // isn't proof of a seat — only JOINED is.
  const { rows: mp } = await c.query(
    `SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2 AND state = 'JOINED'`,
    [matchId, userId]
  );
  if (!mp[0]) fail("you are not in this match");
  const remaining = (new Date(m.ends_at).getTime() - Date.now()) / 1000;
  if (remaining <= MATCH_EXPIRY_MARGIN_SECONDS) fail("The match is about to end");
  if (seconds > remaining - MATCH_EXPIRY_MARGIN_SECONDS)
    fail("That expiry runs past the end of the match");
}

export type CreateInput = {
  kind: "BUY" | "SELL";
  asset: AssetSymbol;
  strikePct: number; // strike as % offset from live spot
  amount: number;
  seconds: number;
  matchId?: number | null;
};

export async function createCardFor(userId: number, input: CreateInput): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
    const matchId = input.matchId ?? null;

    if (!ASSET_MAP[input.asset]) fail("unknown asset");
    // The presets are shortcuts, not a whitelist — any horizon inside the bounds is the
    // player's call. A PvP card is additionally capped by assertMatchWindow below.
    if (!Number.isFinite(input.seconds) || !Number.isInteger(input.seconds)) fail("invalid expiry");
    if (input.seconds < MIN_EXPIRY_SECONDS)
      fail(`The shortest expiry is ${duration(MIN_EXPIRY_SECONDS)}`);
    if (input.seconds > MAX_EXPIRY_SECONDS)
      fail(`The longest expiry is ${duration(MAX_EXPIRY_SECONDS)}`);
    if (!(input.amount > 0) || !Number.isFinite(input.amount)) fail("invalid amount");
    if (!Number.isFinite(input.strikePct) || Math.abs(input.strikePct) > 50)
      fail("strike must be within ±50% of spot");

    // Spot and premium are always recomputed here — never taken from the client.
    const spot = await getPrice(input.asset);
    const strike = +(spot * (1 + input.strikePct / 100)).toFixed(6);
    const amount = +input.amount.toFixed(8);
    const premium = quotePremium({
      asset: input.asset,
      strike,
      amount,
      spot,
      seconds: input.seconds,
    });
    const collateral = input.kind === "SELL" ? collateralFor(strike, amount) : 0;

    return await tx(async (c) => {
      if (matchId !== null) await assertMatchWindow(c, matchId, me.id, input.seconds);
      else await spendEnergy(c, me.id, CFG.OPTION_ENERGY_COST);

      const w = await loadWallet(c, me.id, matchId);

      if (input.kind === "BUY") {
        if (w.opt < premium) fail(`Not enough OPT (need ${premium}, have ${Math.floor(w.opt)})`);
        await applyWallet(c, me.id, matchId, { opt: -premium });
      } else {
        if (w.spendable < collateral)
          fail(
            `Not enough free Portfolio for collateral (need $${collateral.toFixed(0)}, free $${w.spendable.toFixed(0)})`
          );
        await applyWallet(c, me.id, matchId, { opt: premium, locked: collateral });
      }

      const expiresAt = new Date(Date.now() + input.seconds * 1000);
      const { rows } = await c.query(
        `INSERT INTO cards
           (match_id, owner_id, creator_id, kind, asset, strike, amount, spot_at_create,
            premium, collateral, expires_at)
         VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [matchId, me.id, input.kind, input.asset, strike, amount, spot, premium, collateral, expiresAt]
      );
      const id = rows[0].id;

      await logEvent(c, id, "CREATED", {
        actor: me.id,
        to: me.id,
        opt: input.kind === "BUY" ? -premium : premium,
        note:
          input.kind === "BUY"
            ? `paid ${premium} OPT premium`
            : `received ${premium} OPT premium · locked $${collateral.toFixed(2)}`,
      });

      await touchActivity(c, me.id);

      return {
        ok: true,
        message:
          input.kind === "BUY"
            ? `Card #${id} minted · −${premium} OPT`
            : `Card #${id} written · +${premium} OPT · $${collateral.toFixed(0)} locked`,
      };
    });
  });
}

/**
 * Portfolio that has to be burned to cover a shortfall of `needOpt`, rounded up to the cent so
 * the conversion can never land a fraction short of the cost it was sized for.
 */
export function fundingCost(needOpt: number) {
  return Math.ceil((needOpt / CFG.PORTFOLIO_TO_OPT_RATIO) * 100) / 100;
}

/**
 * Exercises a winning Buy Option.
 *
 * `fund` covers a shortfall by burning Portfolio into OPT first, in this same transaction.
 * Exercising costs the whole notional in OPT rather than just the profit, which is faithful to
 * a physically settled call but leaves most wins unaffordable — the player is rich in the
 * dollars they won and poor in the currency needed to collect them. This is exactly the
 * existing Portfolio->OPT conversion followed by the existing exercise, so it moves no rate
 * and opens no arbitrage; it only saves the player from doing the two by hand and stranding
 * the card if they misjudge the amount. It still costs real leaderboard position, so it is
 * never implicit: the caller has to ask for it.
 */
export async function exerciseCardFor(
  userId: number,
  cardId: number,
  opts: { fund?: boolean } = {}
): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
    return await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT * FROM cards WHERE id = $1 FOR UPDATE`,
        [cardId]
      );
      const card = rows[0];
      if (!card) fail("card not found");
      if (card.owner_id !== me.id) fail("you don't own this card");
      if (card.kind !== "BUY") fail("only Buy Options can be exercised");
      if (card.status === "LAPSED") fail("The claim window on this card has closed");
      if (card.status !== "WON") fail("only a winning card can be exercised");

      // The lapse sweep runs in the settle pass, so a card can be past its deadline and still
      // sitting at WON between polls. Checked here too, or the window would be enforced only
      // as fast as someone happens to poll.
      if (
        card.match_id === null &&
        card.exercise_deadline &&
        new Date(card.exercise_deadline).getTime() <= Date.now()
      ) {
        await c.query(`UPDATE cards SET status = 'LAPSED' WHERE id = $1`, [cardId]);
        fail("The claim window on this card has closed");
      }

      // A finished match has already ranked its players, so moving PvP balances now would
      // change a standing nobody can see. Match end auto-exercises whatever was affordable.
      if (card.match_id !== null) {
        const { rows: m } = await c.query(`SELECT status FROM matches WHERE id = $1 FOR SHARE`, [
          card.match_id,
        ]);
        if (m[0]?.status !== "ACTIVE") fail("That match is over");
      }

      const cost = exerciseCost(card.strike, card.amount);
      const payout = exercisePayout(card.strike, card.amount, card.settle_price);

      const w = await loadWallet(c, me.id, card.match_id);
      let burned = 0;
      if (w.opt < cost) {
        if (!opts.fund)
          fail(`Exercising costs ${Math.ceil(cost)} OPT — you have ${Math.floor(w.opt)}`);

        // Sized here, never taken from the client: the shortfall is whatever it is under this
        // row lock, which is not necessarily what the button last rendered.
        burned = fundingCost(cost - w.opt);
        if (w.spendable < burned)
          fail(
            `Covering this needs $${burned.toFixed(2)} of free Portfolio — you have $${w.spendable.toFixed(2)}`
          );
        await applyWallet(c, me.id, card.match_id, {
          portfolio: -burned,
          opt: burned * CFG.PORTFOLIO_TO_OPT_RATIO,
        });
        await logEvent(c, cardId, "FUNDED", {
          actor: me.id,
          opt: burned * CFG.PORTFOLIO_TO_OPT_RATIO,
          portfolio: -burned,
          note: `burned $${burned.toFixed(2)} Portfolio to cover the exercise cost`,
        });
      }

      await applyWallet(c, me.id, card.match_id, { opt: -cost, portfolio: payout });
      await c.query(`UPDATE cards SET status = 'EXERCISED' WHERE id = $1`, [cardId]);

      // XP for claiming, on top of what the card already earned at settlement. PvP is
      // excluded: XP is global-only progression there, paid once at the whistle (§29).
      const xp = card.match_id === null ? CFG.EXERCISE_XP : 0;
      if (xp) await addXp(c, me.id, xp);

      await logEvent(c, cardId, "EXERCISED", {
        actor: me.id,
        opt: -cost,
        portfolio: payout,
        note:
          `burned ${cost.toFixed(0)} OPT for $${payout.toFixed(2)} Portfolio` +
          (xp ? ` · +${xp} XP` : ""),
      });
      await touchActivity(c, me.id);

      const net = payout - burned;
      return {
        ok: true,
        message: burned
          ? `Exercised · burned $${burned.toFixed(0)} to cover · net +$${net.toFixed(0)} Portfolio${xp ? ` · +${xp} XP` : ""}`
          : `Exercised · −${cost.toFixed(0)} OPT · +$${payout.toFixed(0)} Portfolio${xp ? ` · +${xp} XP` : ""}`,
      };
    });
  });
}

/**
 * Lists a card on the marketplace.
 *
 * `ask` is optional for a Buy card and required for a Sell card, and the asymmetry is
 * deliberate. A Buy card's worth is something the engine already computes — asking the
 * player to type it is asking them to guess at a number we know better — so leaving `ask`
 * off re-quotes it here, at live spot, at submit time. A Sell card's takeover premium is
 * genuinely the seller's call: they are paying someone to absorb an obligation, and there
 * is no fair value to default to.
 */
export async function listCardFor(userId: number, cardId: number, ask?: number | null): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
    const custom = ask ?? null;
    if (custom !== null && (!(custom > 0) || !Number.isFinite(custom))) fail("invalid price");

    return await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM cards WHERE id = $1 FOR UPDATE`, [cardId]);
      const card = rows[0];
      if (!card) fail("card not found");
      if (card.owner_id !== me.id) fail("you don't own this card");
      if (card.status !== "ACTIVE") fail("only active cards can be listed");
      if (card.for_sale) fail("this card is already listed");
      // A card stays ACTIVE until a poll settles it, so it can be past its expiry right now.
      // Listing one creates an offer nobody can accept — acquireCard rejects it on sight —
      // and prices it at the floor, since an expired card has no value left to quote.
      if (new Date(card.expires_at).getTime() <= Date.now()) fail("this card is already expiring");

      let price = custom;
      if (price === null) {
        if (card.kind !== "BUY") fail("set the takeover premium you're offering");
        const spot = await getPrice(card.asset);
        const secondsLeft = (new Date(card.expires_at).getTime() - Date.now()) / 1000;
        const value = cardValue({
          asset: card.asset,
          strike: card.strike,
          amount: card.amount,
          spot,
          secondsLeft,
        });
        price = Math.max(0.01, +value.total.toFixed(2));
      }

      await c.query(`UPDATE cards SET for_sale = TRUE, ask = $2 WHERE id = $1`, [cardId, price]);
      await logEvent(c, cardId, "LISTED", {
        actor: me.id,
        note:
          card.kind === "BUY"
            ? `asking $${price.toFixed(2)}${custom === null ? " (live value)" : ""}`
            : `offering ${price} OPT to assume`,
      });
      await touchActivity(c, me.id);
      return {
        ok: true,
        message:
          card.kind === "BUY"
            ? `Listed at $${price.toFixed(2)}`
            : `Listed · offering ${price} OPT to assume`,
      };
    });
  });
}

export async function unlistCardFor(userId: number, cardId: number): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
    return await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM cards WHERE id = $1 FOR UPDATE`, [cardId]);
      if (!rows[0]) fail("card not found");
      if (rows[0].owner_id !== me.id) fail("you don't own this card");
      if (!rows[0].for_sale) fail("this card is not listed");
      await c.query(`UPDATE cards SET for_sale = FALSE, ask = NULL WHERE id = $1`, [cardId]);
      await logEvent(c, cardId, "UNLISTED", { actor: me.id });
      await touchActivity(c, me.id);
      return { ok: true, message: "Removed from the marketplace" };
    });
  });
}

/**
 * Acquires a listed card. Both paths are atomic and re-check affordability under a row lock.
 *
 * BUY  — ownership transfers for Portfolio $ (§7).
 * SELL — the assumer takes on the obligation: their collateral locks, the previous
 *        owner's unlocks, and the previous owner pays them the takeover premium in OPT (§11).
 */
export async function acquireCardFor(userId: number, cardId: number): Promise<Res> {
  return guard(async () => {
    const me = { id: userId };
    return await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM cards WHERE id = $1 FOR UPDATE`, [cardId]);
      const card = rows[0];
      if (!card) fail("card not found");
      if (!card.for_sale || card.ask === null) fail("this card is not for sale");
      if (card.status !== "ACTIVE") fail("this card has already resolved");
      if (card.owner_id === me.id) fail("you already own this card");
      if (new Date(card.expires_at).getTime() <= Date.now()) fail("this card is expiring right now");

      const seller = card.owner_id;
      const matchId = card.match_id;
      if (matchId !== null) {
        // Mirrors exerciseCard: a finished match has already ranked its players, so moving PvP
        // balances now would change a standing nobody can see. FOR SHARE because the settler
        // finalises under FOR UPDATE on this row.
        const { rows: m } = await c.query(`SELECT status FROM matches WHERE id = $1 FOR SHARE`, [
          matchId,
        ]);
        if (m[0]?.status !== "ACTIVE") fail("That match is over");
        const { rows: mp } = await c.query(
          `SELECT 1 FROM match_players WHERE match_id = $1 AND user_id = $2 AND state = 'JOINED'`,
          [matchId, me.id]
        );
        if (!mp[0]) fail("you are not in this match");
      }

      // Lock both wallets in a stable order so two simultaneous buys can't deadlock.
      const [aId, bId] = seller < me.id ? [seller, me.id] : [me.id, seller];
      const wA = await loadWallet(c, aId, matchId);
      const wB = await loadWallet(c, bId, matchId);
      const sellerW = seller === aId ? wA : wB;
      const buyerW = me.id === aId ? wA : wB;

      if (card.kind === "BUY") {
        const price = Number(card.ask);
        if (buyerW.spendable < price)
          fail(`Need $${price.toFixed(0)} free Portfolio — you have $${buyerW.spendable.toFixed(0)}`);
        await applyWallet(c, me.id, matchId, { portfolio: -price });
        await applyWallet(c, seller, matchId, { portfolio: price });
        await c.query(`UPDATE cards SET owner_id = $2, for_sale = FALSE, ask = NULL WHERE id = $1`, [
          cardId,
          me.id,
        ]);
        await logEvent(c, cardId, "SOLD", {
          actor: me.id,
          from: seller,
          to: me.id,
          portfolio: price,
          note: `card bought for $${price.toFixed(2)} Portfolio`,
        });
        await touchActivity(c, me.id);
        return { ok: true, message: `Card #${cardId} acquired for $${price.toFixed(0)}` };
      }

      // SELL: obligation handover.
      const takeover = Number(card.ask);
      const collateral = Number(card.collateral);
      if (buyerW.spendable < collateral)
        fail(
          `Assuming this needs $${collateral.toFixed(0)} free Portfolio as collateral — you have $${buyerW.spendable.toFixed(0)}`
        );
      if (sellerW.opt < takeover) fail("the current owner can no longer pay the takeover premium");

      await applyWallet(c, seller, matchId, { locked: -collateral, opt: -takeover });
      await applyWallet(c, me.id, matchId, { locked: collateral, opt: takeover });
      await c.query(`UPDATE cards SET owner_id = $2, for_sale = FALSE, ask = NULL WHERE id = $1`, [
        cardId,
        me.id,
      ]);
      await logEvent(c, cardId, "ASSUMED", {
        actor: me.id,
        from: seller,
        to: me.id,
        opt: takeover,
        note: `obligation assumed for ${takeover} OPT · $${collateral.toFixed(2)} collateral moved`,
      });
      await touchActivity(c, me.id);
      return {
        ok: true,
        message: `Obligation assumed · +${takeover} OPT · $${collateral.toFixed(0)} locked`,
      };
    });
  });
}

export async function cardHistory(cardId: number): Promise<CardEventDTO[]> {
  return q<CardEventDTO>(
    `SELECT e.id, e.type, a.username AS actor, f.username AS from_user, t.username AS to_user,
            e.opt_delta, e.portfolio_delta, e.note, e.created_at
       FROM card_events e
       LEFT JOIN users a ON a.id = e.actor_id
       LEFT JOIN users f ON f.id = e.from_user_id
       LEFT JOIN users t ON t.id = e.to_user_id
      WHERE e.card_id = $1 ORDER BY e.id ASC`,
    [cardId]
  );
}
