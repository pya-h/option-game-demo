/**
 * Settlement against a real Postgres.
 *
 * Every test runs inside a transaction that is always rolled back, so these can be pointed at
 * the same database the demo uses without leaving a trace. Nothing here commits.
 */
import type { PoolClient } from "pg";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { CFG } from "@/lib/config";
import { pool } from "@/lib/db";
import { finalizeMatchInTx, settleCard } from "@/lib/settle";

const hasDb = !!process.env.DATABASE_URL;
const d = hasDb ? describe : describe.skip;

let c: PoolClient;

/** Wraps each test in a transaction that is rolled back, whatever the outcome. */
async function begin() {
  c = await pool.connect();
  await c.query("BEGIN");
}
async function rollback() {
  await c.query("ROLLBACK").catch(() => {});
  c.release();
}

let seq = 0;
async function mkUser(over: { opt?: number; portfolio?: number; locked?: number } = {}) {
  const { rows } = await c.query(
    `INSERT INTO users (username, opt, portfolio, locked, energy, energy_capacity)
     VALUES ($1,$2,$3,$4,0,$5) RETURNING *`,
    [
      `t${Date.now()}_${seq++}`,
      over.opt ?? 1000,
      over.portfolio ?? 1000,
      over.locked ?? 0,
      CFG.INITIAL_ENERGY_CAPACITY,
    ]
  );
  return rows[0];
}

async function mkCard(o: {
  owner: number;
  kind: "BUY" | "SELL";
  strike: number;
  amount: number;
  collateral?: number;
  matchId?: number | null;
  premium?: number;
}) {
  const { rows } = await c.query(
    `INSERT INTO cards (match_id, owner_id, creator_id, kind, asset, strike, amount,
                        spot_at_create, premium, collateral, expires_at)
     VALUES ($1,$2,$2,$3,'BTC',$4,$5,$4,$6,$7, now() - interval '1 second') RETURNING *`,
    [
      o.matchId ?? null,
      o.owner,
      o.kind,
      o.strike,
      o.amount,
      o.premium ?? 10,
      o.collateral ?? 0,
    ]
  );
  const r = rows[0];
  return {
    id: r.id,
    match_id: r.match_id,
    owner_id: r.owner_id,
    kind: r.kind,
    asset: r.asset,
    strike: Number(r.strike),
    amount: Number(r.amount),
    collateral: Number(r.collateral),
  };
}

const getUser = async (id: number) =>
  (await c.query(`SELECT * FROM users WHERE id = $1`, [id])).rows[0];
const getCard = async (id: number) =>
  (await c.query(`SELECT * FROM cards WHERE id = $1`, [id])).rows[0];

d("settleCard — Buy options", () => {
  beforeEach(begin);
  afterEach(rollback);

  it("marks a card above its strike WON and awards XP", async () => {
    const u = await mkUser();
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1 });
    await settleCard(c, card, 120);

    const after = await getCard(card.id);
    expect(after.status).toBe("WON");
    expect(Number(after.settle_price)).toBe(120);
    expect(after.settled_at).not.toBeNull();
    expect((await getUser(u.id)).xp).toBe(u.xp + CFG.SUCCESSFUL_OPTION_XP);
  });

  it("marks a card at or below its strike LOST and awards nothing", async () => {
    const u = await mkUser();
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1 });
    await settleCard(c, card, 100);

    expect((await getCard(card.id)).status).toBe("LOST");
    expect((await getUser(u.id)).xp).toBe(u.xp);
  });

  it("does not move Portfolio at settlement — that only happens on exercise", async () => {
    const u = await mkUser({ portfolio: 500 });
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1 });
    await settleCard(c, card, 200);
    expect(Number((await getUser(u.id)).portfolio)).toBe(500);
  });

  it("takes a winning card off the marketplace", async () => {
    const u = await mkUser();
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1 });
    await c.query(`UPDATE cards SET for_sale = TRUE, ask = 5 WHERE id = $1`, [card.id]);
    await settleCard(c, card, 150);
    expect((await getCard(card.id)).for_sale).toBe(false);
  });
});

d("settleCard — Sell options", () => {
  beforeEach(begin);
  afterEach(rollback);

  it("releases the collateral and awards XP when the obligation survives", async () => {
    const u = await mkUser({ portfolio: 1000, locked: 300 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
    });
    await settleCard(c, card, 90);

    const after = await getUser(u.id);
    expect((await getCard(card.id)).status).toBe("SETTLED");
    expect(Number(after.locked)).toBe(0);
    expect(Number(after.portfolio)).toBe(1000);
    expect(after.xp).toBe(u.xp + CFG.SUCCESSFUL_OPTION_XP);
  });

  it("charges the writer the in-the-money distance and releases the lock", async () => {
    const u = await mkUser({ portfolio: 1000, locked: 300 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
    });
    await settleCard(c, card, 110); // (110-100)*3 = 30

    const after = await getUser(u.id);
    expect(Number(after.portfolio)).toBe(970);
    expect(Number(after.locked)).toBe(0);
    expect(after.xp).toBe(u.xp); // no XP for an obligation that paid out
  });

  it("caps the loss at the collateral, so a player can never go negative", async () => {
    const u = await mkUser({ portfolio: 1000, locked: 300 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
    });
    await settleCard(c, card, 100_000); // uncapped this would be ~300k

    const after = await getUser(u.id);
    expect(Number(after.portfolio)).toBe(700);
    expect(Number(after.locked)).toBe(0);
    expect(Number(after.portfolio)).toBeGreaterThanOrEqual(0);
  });

  it("treats finishing exactly at the strike as surviving", async () => {
    const u = await mkUser({ portfolio: 1000, locked: 300 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
    });
    await settleCard(c, card, 100);
    expect(Number((await getUser(u.id)).portfolio)).toBe(1000);
    expect((await getUser(u.id)).xp).toBe(u.xp + CFG.SUCCESSFUL_OPTION_XP);
  });
});

d("settleCard — PvP isolation", () => {
  beforeEach(begin);
  afterEach(rollback);

  async function mkMatch(players: { id: number; opt: number; portfolio: number }[]) {
    const { rows } = await c.query(
      `INSERT INTO matches (name, creator_id, mode, status, duration_min, started_at, ends_at)
       VALUES ('t', $1, 'GROUP', 'ACTIVE', 5, now(), now() + interval '5 minutes') RETURNING id`,
      [players[0].id]
    );
    const matchId = rows[0].id;
    for (const p of players) {
      await c.query(
        `INSERT INTO match_players (match_id, user_id, state, pvp_opt, pvp_portfolio, joined_at)
         VALUES ($1,$2,'JOINED',$3,$4, now())`,
        [matchId, p.id, p.opt, p.portfolio]
      );
    }
    return matchId;
  }
  const getMp = async (matchId: number, userId: number) =>
    (
      await c.query(`SELECT * FROM match_players WHERE match_id = $1 AND user_id = $2`, [
        matchId,
        userId,
      ])
    ).rows[0];

  it("awards no XP for a card won inside a match — PvP pays out at the whistle", async () => {
    const u = await mkUser();
    const matchId = await mkMatch([{ id: u.id, opt: 1000, portfolio: 0 }]);
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1, matchId });
    await settleCard(c, card, 150);

    expect((await getCard(card.id)).status).toBe("WON");
    expect((await getUser(u.id)).xp).toBe(u.xp);
  });

  it("charges a PvP obligation against match balances, never global ones", async () => {
    const u = await mkUser({ portfolio: 5000, locked: 0 });
    const matchId = await mkMatch([{ id: u.id, opt: 1000, portfolio: 500 }]);
    await c.query(`UPDATE match_players SET pvp_locked = 300 WHERE match_id = $1 AND user_id = $2`, [
      matchId,
      u.id,
    ]);
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
      matchId,
    });
    await settleCard(c, card, 110);

    const mp = await getMp(matchId, u.id);
    expect(Number(mp.pvp_portfolio)).toBe(470);
    expect(Number(mp.pvp_locked)).toBe(0);

    const global = await getUser(u.id);
    expect(Number(global.portfolio)).toBe(5000);
    expect(Number(global.locked)).toBe(0);
  });

  it("finalises a match: ranks on PvP Portfolio and pays the winner a global reward", async () => {
    const win = await mkUser({ opt: 0, portfolio: 0 });
    const lose = await mkUser({ opt: 0, portfolio: 0 });
    const matchId = await mkMatch([
      { id: win.id, opt: 100, portfolio: 900 },
      { id: lose.id, opt: 100, portfolio: 200 },
    ]);

    await finalizeMatchInTx(c, matchId, { BTC: { asset: "BTC", price: 100 } } as never);

    expect((await getMp(matchId, win.id)).final_rank).toBe(1);
    expect((await getMp(matchId, lose.id)).final_rank).toBe(2);

    const w = await getUser(win.id);
    expect(w.xp).toBe(CFG.PVP_WIN_XP);
    expect(Number(w.opt)).toBe(CFG.PVP_WIN_OPT_REWARD);
    expect(Number(w.portfolio)).toBe(CFG.PVP_WIN_PORTFOLIO_REWARD);

    const l = await getUser(lose.id);
    expect(l.xp).toBe(0);
    expect(Number(l.opt)).toBe(0);

    const m = (await c.query(`SELECT status FROM matches WHERE id = $1`, [matchId])).rows[0];
    expect(m.status).toBe("FINISHED");
  });

  it("auto-exercises a winning card the player never got to click", async () => {
    const u = await mkUser({ opt: 0, portfolio: 0 });
    const matchId = await mkMatch([{ id: u.id, opt: 10_000, portfolio: 0 }]);
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1, matchId });

    await finalizeMatchInTx(c, matchId, { BTC: { asset: "BTC", price: 150 } } as never);

    expect((await getCard(card.id)).status).toBe("EXERCISED");
    const mp = await getMp(matchId, u.id);
    expect(Number(mp.pvp_opt)).toBe(10_000 - 100 * CFG.EXERCISE_OPT_PER_DOLLAR);
    expect(Number(mp.pvp_portfolio)).toBe(150);
  });

  it("leaves a winning card alone when the player cannot afford to exercise it", async () => {
    const u = await mkUser({ opt: 0, portfolio: 0 });
    const matchId = await mkMatch([{ id: u.id, opt: 1, portfolio: 0 }]);
    const card = await mkCard({ owner: u.id, kind: "BUY", strike: 100, amount: 1, matchId });

    await finalizeMatchInTx(c, matchId, { BTC: { asset: "BTC", price: 150 } } as never);

    expect((await getCard(card.id)).status).toBe("WON");
    expect(Number((await getMp(matchId, u.id)).pvp_opt)).toBe(1);
  });

  it("closes out an in-match card with no price rather than stranding it ACTIVE", async () => {
    const u = await mkUser();
    const matchId = await mkMatch([{ id: u.id, opt: 100, portfolio: 500 }]);
    await c.query(`UPDATE match_players SET pvp_locked = 300 WHERE match_id = $1 AND user_id = $2`, [
      matchId,
      u.id,
    ]);
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 3,
      collateral: 300,
      matchId,
    });

    // No price for BTC at all: the settler must not leave the card open.
    await finalizeMatchInTx(c, matchId, {} as never);

    expect((await getCard(card.id)).status).toBe("SETTLED");
    const mp = await getMp(matchId, u.id);
    expect(Number(mp.pvp_locked)).toBe(0);
    expect(Number(mp.pvp_portfolio)).toBe(500); // nobody is charged for our missing data
  });
});

d("money conservation", () => {
  beforeEach(begin);
  afterEach(rollback);

  it("destroys exactly the collateral a Sell writer loses, and no more", async () => {
    const u = await mkUser({ portfolio: 1000, locked: 400 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 4,
      collateral: 400,
    });
    const before = Number((await getUser(u.id)).portfolio);
    await settleCard(c, card, 125); // (125-100)*4 = 100

    const after = Number((await getUser(u.id)).portfolio);
    expect(before - after).toBe(100);
  });

  it("keeps locked within portfolio at every step, as the CHECK constraint demands", async () => {
    const u = await mkUser({ portfolio: 500, locked: 500 });
    const card = await mkCard({
      owner: u.id,
      kind: "SELL",
      strike: 100,
      amount: 5,
      collateral: 500,
    });
    // Worst case: the entire collateral is consumed.
    await settleCard(c, card, 1_000_000);
    const after = await getUser(u.id);
    expect(Number(after.portfolio)).toBe(0);
    expect(Number(after.locked)).toBe(0);
  });
});

afterAll(async () => {
  await pool.end().catch(() => {});
});
