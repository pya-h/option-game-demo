"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Flame, Sparkles, Tag, TagIcon, X } from "lucide-react";
import { useState } from "react";
import { acquireCard, cardHistory, exerciseCard, listCard, unlistCard } from "@/app/actions/cards";
import { CFG } from "@/lib/config";
import { opt as fmtOpt, usd } from "@/lib/fmt";
import { cardValue } from "@/lib/options";
import type { CardDTO, CardEventDTO, PriceDTO } from "@/lib/types";
import { useNow } from "./Countdown";
import { useGame } from "./GameProvider";
import OptionCard from "./OptionCard";

export default function CardGrid({
  cards,
  prices,
  meId,
  spendable,
  optBalance,
  readOnly = false,
  showDepth = false,
}: {
  cards: CardDTO[];
  prices?: PriceDTO[];
  meId?: number;
  spendable?: number;
  optBalance?: number;
  readOnly?: boolean;
  /** Marketplace view: rate each listing against what the engine says it's worth. */
  showDepth?: boolean;
}) {
  const { state, run, busy } = useGame();
  const [listing, setListing] = useState<CardDTO | null>(null);
  // Card id -> its event log, loaded the first time that card is turned over.
  const [logs, setLogs] = useState<Record<number, CardEventDTO[]>>({});

  const px = prices ?? state?.prices ?? [];
  const uid = meId ?? state?.me.id ?? 0;
  const free = spendable ?? state?.me.spendable ?? 0;
  const optBal = optBalance ?? state?.me.opt ?? 0;
  const mode = state?.cfg.exercisePayoutMode ?? "market";

  const loadLog = async (card: CardDTO) => {
    if (logs[card.id]) return;
    const events = await cardHistory(card.id);
    setLogs((m) => ({ ...m, [card.id]: events }));
  };

  if (!cards.length) return <p className="py-8 text-center text-sm text-mute">Nothing here yet.</p>;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {cards.map((card, i) => {
          const spot = px.find((p) => p.asset === card.asset)?.price ?? 0;
          const mine = card.owner_id === uid;
          const live = card.status === "ACTIVE";
          let actions: React.ReactNode = null;

          if (!readOnly && mine && live) {
            actions = card.for_sale ? (
              <button className="btn btn-ghost flex-1 py-1.5 text-xs" disabled={busy}
                onClick={() => run(() => unlistCard(card.id))}>
                Cancel listing
              </button>
            ) : (
              <button className="btn btn-ghost flex-1 py-1.5 text-xs" onClick={() => setListing(card)}>
                <Tag size={12} className="mr-1 inline" />
                {card.kind === "BUY" ? "Sell card" : "Offload obligation"}
              </button>
            );
          } else if (!readOnly && mine && card.status === "WON") {
            // Mirrors lib/options exerciseCost/exercisePayout with the rates the server
            // actually runs on. The fallback is the shared default rather than 1: state can
            // still be loading here (a match room polls on its own clock), and quoting a cost
            // five times too cheap would enable a button the server then refuses.
            const rate = state?.cfg.exerciseOptPerDollar ?? CFG.EXERCISE_OPT_PER_DOLLAR;
            const ratio = state?.cfg.portfolioToOptRatio ?? CFG.PORTFOLIO_TO_OPT_RATIO;
            const cost = card.strike * card.amount * rate;
            const payout =
              mode === "strike" ? card.strike * card.amount : (card.settle_price ?? 0) * card.amount;
            actions = (
              <Exercise
                card={card}
                cost={cost}
                payout={payout}
                optBal={optBal}
                free={free}
                ratio={ratio}
                busy={busy}
                onRun={(fund) => run(() => exerciseCard(card.id, fund))}
              />
            );
          } else if (!readOnly && !mine && live && card.for_sale) {
            const isBuy = card.kind === "BUY";
            const need = isBuy ? Number(card.ask) : Number(card.collateral);
            const short = free < need;
            actions = (
              <button
                className={`btn flex-1 py-1.5 text-xs ${isBuy ? "btn-primary" : "btn-sell"}`}
                disabled={busy || short}
                title={short ? `Need ${usd(need, 0)} free Portfolio` : undefined}
                onClick={() => run(() => acquireCard(card.id))}
              >
                {isBuy
                  ? `Buy for ${usd(Number(card.ask), 0)}`
                  : `Assume · +${fmtOpt(Number(card.ask))}`}
              </button>
            );
          }

          return (
            // Column, so the card fills the row's height and any depth strip hangs below it.
            <div key={card.id} className="flex flex-col">
              <OptionCard
                card={card}
                spot={spot}
                meId={uid}
                index={i}
                actions={actions}
                history={logs[card.id] ?? null}
                onFlip={() => loadLog(card)}
              />
              {showDepth && live && card.for_sale && card.kind === "BUY" && (
                <Depth card={card} spot={spot} />
              )}
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {listing && (
          <ListDialog
            card={listing}
            spot={px.find((p) => p.asset === listing.asset)?.price ?? 0}
            onClose={() => setListing(null)}
            onSubmit={async (ask) => {
              const ok = await run(() => listCard(listing.id, ask));
              if (ok) setListing(null);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * The exercise control on a winning card.
 *
 * Exercising burns the whole notional in OPT, not just the profit, so a player is routinely
 * rich in the dollars they won and poor in the currency needed to collect them. Rather than
 * dead-ending there, the button offers to burn the shortfall out of Portfolio first — but that
 * costs the exact number the leaderboard ranks on, so it asks before it does it. The server
 * re-sizes the burn under a row lock; these figures are only what the player is shown.
 */
function Exercise({
  card,
  cost,
  payout,
  optBal,
  free,
  ratio,
  busy,
  onRun,
}: {
  card: CardDTO;
  cost: number;
  payout: number;
  optBal: number;
  free: number;
  ratio: number;
  busy: boolean;
  onRun: (fund: boolean) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const short = optBal < cost;
  const burn = short ? Math.ceil(((cost - optBal) / ratio) * 100) / 100 : 0;
  const canFund = short && free >= burn;

  if (!short) {
    return (
      <button
        className="btn btn-gold flex-1 py-1.5 text-xs"
        disabled={busy}
        title={`Burn ${Math.ceil(cost)} OPT for ${usd(payout, 2)} Portfolio`}
        onClick={() => onRun(false)}
      >
        <Sparkles size={12} className="mr-1 inline" />
        Exercise · +{usd(payout, 0)}
      </button>
    );
  }

  if (!canFund) {
    return (
      <button
        className="btn btn-ghost flex-1 py-1.5 text-[11px]"
        disabled
        title={`Needs ${Math.ceil(cost)} OPT, or ${usd(burn, 2)} of free Portfolio to cover the gap — you have ${usd(free, 2)} free`}
      >
        Need {Math.ceil(cost - optBal)} more OPT
      </button>
    );
  }

  if (!confirming) {
    return (
      <button
        className="btn btn-ghost flex-1 border-gold/50 py-1.5 text-[11px] text-gold"
        disabled={busy}
        title={`Short ${Math.ceil(cost - optBal)} OPT · burning ${usd(burn, 2)} Portfolio covers it`}
        onClick={() => setConfirming(true)}
      >
        <Flame size={11} className="mr-1 inline" />
        Burn {usd(burn, 0)} to cover?
      </button>
    );
  }

  return (
    <div className="flex flex-1 items-center gap-1.5">
      <button
        className="btn btn-ghost px-2 py-1.5 text-[11px]"
        onClick={() => setConfirming(false)}
      >
        <X size={11} />
      </button>
      <button
        className="btn btn-gold flex-1 py-1.5 text-[11px]"
        disabled={busy}
        title={`Burns ${usd(burn, 2)} Portfolio into ${Math.ceil(burn * ratio)} OPT, then exercises card #${card.id}`}
        onClick={() => {
          setConfirming(false);
          onRun(true);
        }}
      >
        Burn &amp; exercise · net +{usd(payout - burn, 0)}
      </button>
    </div>
  );
}

/**
 * How a listing's ask compares to what the engine says the card is worth right now.
 *
 * The For Sale board otherwise gives no way to tell a bargain from a rip-off: a price is just a
 * number until you can see it against something. The comparison is the same `cardValue` the
 * server prices with, so it's the honest one — and it moves with the market, which is the point:
 * a fair ask can become a bargain without the seller touching it. Only for Buy cards; a Sell
 * card's takeover premium is what the seller is willing to pay, and has no fair value.
 */
function Depth({ card, spot }: { card: CardDTO; spot: number }) {
  const now = useNow();
  if (!spot || !card.ask) return null;

  const secondsLeft = Math.max(0, (new Date(card.expires_at).getTime() - now) / 1000);
  const value = cardValue({
    asset: card.asset,
    strike: card.strike,
    amount: card.amount,
    spot,
    secondsLeft,
  }).total;
  if (value <= 0) return null;

  const ask = Number(card.ask);
  const delta = ((ask - value) / value) * 100;
  // A few percent either way is noise, not a signal — the value moves every poll.
  const cheap = delta <= -5;
  const dear = delta >= 5;

  return (
    <div
      data-depth={cheap ? "under" : dear ? "over" : "fair"}
      className={`mt-1.5 flex items-baseline gap-1.5 rounded-lg border px-2.5 py-1.5 text-[10px] ${
        cheap
          ? "border-mint/40 bg-mint/10 text-mint"
          : dear
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-edge/70 bg-black/25 text-mute"
      }`}
    >
      <span className="tabnum font-mono">{usd(ask, 0)}</span>
      <span className="opacity-60">asked ·</span>
      <span className="tabnum font-mono opacity-80">{usd(value, 0)}</span>
      <span className="opacity-60">value</span>
      <span className="tabnum ml-auto font-mono font-semibold">
        {cheap ? "▼" : dear ? "▲" : "≈"} {Math.abs(delta).toFixed(0)}%
        <span className="ml-1 opacity-70">{cheap ? "under" : dear ? "over" : "fair"}</span>
      </span>
    </div>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="panel panel-hi w-full max-w-md p-5"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

/**
 * A Buy card lists at its live value by default — that number is computed, not guessed, so
 * asking the player for it would only invite a worse answer. Custom pricing is still there,
 * one click away. A Sell card has no fair value to default to: the takeover premium is what
 * the seller is willing to pay someone to absorb the obligation, so it stays a plain input.
 */
function ListDialog({
  card,
  spot,
  onClose,
  onSubmit,
}: {
  card: CardDTO;
  spot: number;
  onClose: () => void;
  onSubmit: (ask: number | null) => void;
}) {
  const isBuy = card.kind === "BUY";
  const [custom, setCustom] = useState(!isBuy);
  const [ask, setAsk] = useState<number | null>(isBuy ? null : Math.ceil(card.premium * 1.4));

  const secondsLeft = Math.max(0, (new Date(card.expires_at).getTime() - Date.now()) / 1000);
  const live = spot
    ? cardValue({ asset: card.asset, strike: card.strike, amount: card.amount, spot, secondsLeft })
    : null;

  // Only sent when the player overrode it; otherwise the server re-quotes at submit time so
  // the listed price is the value at that instant, not whatever this dialog last rendered.
  const submitted = custom ? ask : null;
  const ready = custom ? (ask ?? 0) > 0 : !!live;

  return (
    <Shell onClose={onClose}>
      <div className="mb-1 flex items-center gap-2">
        <TagIcon size={16} className="text-gold" />
        <h3 className="font-semibold">
          {isBuy ? "Sell this Buy Option" : "Offload this obligation"}
        </h3>
        <button onClick={onClose} className="ml-auto text-mute hover:text-white">
          <X size={16} />
        </button>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-mute">
        {isBuy
          ? "Another player pays this in Portfolio Value and becomes the owner, taking all future rights to the card."
          : `Whoever assumes this card locks ${usd(card.collateral, 0)} of their own Portfolio as collateral and takes on the obligation. You pay them the takeover premium in OPT, and your collateral is released. You originally received ${fmtOpt(card.premium)}.`}
      </p>

      {isBuy && (
        <div className="mb-3 rounded-xl border border-edge/70 bg-black/25 px-3 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-mute">Live value</span>
            <motion.span
              key={live?.total.toFixed(2)}
              initial={{ scale: 1.12 }}
              animate={{ scale: 1 }}
              className="tabnum ml-auto font-mono text-lg font-semibold text-buy"
            >
              {live ? usd(live.total) : "—"}
            </motion.span>
          </div>
          {live && (
            <div className="tabnum mt-1 text-[10px] text-mute">
              {usd(live.intrinsic)} intrinsic + {usd(live.timeValue)} time value · re-quoted the
              moment you list
            </div>
          )}
        </div>
      )}

      {isBuy && (
        <button
          onClick={() => {
            setCustom((v) => !v);
            if (!custom && ask === null && live) setAsk(+live.total.toFixed(2));
          }}
          className="mb-3 text-xs text-mute underline decoration-dotted underline-offset-4 hover:text-slate-200"
        >
          {custom ? "Use the live value instead" : "Set a custom price"}
        </button>
      )}

      {custom && (
        <>
          <label className="mb-1.5 block text-xs text-mute">
            {isBuy ? "Asking price (Portfolio $)" : "Takeover premium you pay (OPT)"}
          </label>
          <input
            type="number"
            min={0}
            step="any"
            value={ask ?? ""}
            onChange={(e) => setAsk(Math.max(0, Number(e.target.value) || 0))}
            className="tabnum mb-4 w-full rounded-xl border border-edge bg-black/40 px-3 py-2.5 font-mono outline-none focus:border-buy"
          />
        </>
      )}

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn flex-1 ${isBuy ? "btn-primary" : "btn-sell"}`}
          disabled={!ready}
          onClick={() => onSubmit(submitted)}
        >
          {isBuy && !custom ? "List at live value" : "List it"}
        </button>
      </div>
    </Shell>
  );
}
