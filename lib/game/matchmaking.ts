/**
 * Random matchmaking: press search, get a game.
 *
 * A player joins one bucket, identified by (mode, size, duration_min) — everyone in a bucket
 * asked for the same shape of match, so a 3-player queue never absorbs someone who wanted 5.
 * The matcher itself runs inside the lazy settle pass, under the same advisory lock, which is
 * what lets this work with no cron and no worker process: whichever request happens to be
 * polling does the work, and the lock means only one does it at a time.
 *
 * Energy is charged when a match forms, never when queueing. Searching should cost nothing,
 * and a player who wanders off while queued must not be billed for a game they never played.
 */
import type { PoolClient } from "pg";
import {
  CFG,
  GROUP_SIZES,
  MAX_MATCH_MINUTES,
  MIN_MATCH_MINUTES,
  QUEUE_TIMEOUT_SECONDS,
} from "@/lib/config";
import { fail, tx } from "@/lib/db";
import { accrue } from "@/lib/energy";
import { type Res, guard } from "./guard";

export type QueueRequest = { mode: "DUEL" | "GROUP"; size: number; durationMin: number };

/**
 * Enters the queue. Idempotent in the sense that matters: the table's primary key is the user,
 * so a second search replaces the first rather than putting the player in two buckets at once.
 */
export async function joinQueueFor(userId: number, input: QueueRequest): Promise<Res> {
  return guard(async () => {
    const durationMin = Math.round(input.durationMin);
    if (!Number.isFinite(durationMin)) fail("invalid match duration");
    if (durationMin < MIN_MATCH_MINUTES) fail(`The shortest match is ${MIN_MATCH_MINUTES} minutes`);
    if (durationMin > MAX_MATCH_MINUTES) fail(`The longest match is ${MAX_MATCH_MINUTES / 60} hours`);

    const size = input.mode === "DUEL" ? 2 : Math.round(input.size);
    if (input.mode === "GROUP" && !GROUP_SIZES.includes(size)) fail("pick a group size");

    return await tx(async (c) => {
      // Checked here as well as at form time, so a player without the Energy to play is told
      // now rather than after sitting in a queue.
      const { rows } = await c.query(
        `SELECT energy, energy_capacity, energy_updated_at FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );
      if (!rows[0]) fail("player not found");
      if (accrue(rows[0]).energy < CFG.PVP_ENERGY_COST)
        fail(`Entering a match costs ${CFG.PVP_ENERGY_COST} Energy`);

      const { rows: live } = await c.query(
        `SELECT m.id FROM match_players mp
           JOIN matches m ON m.id = mp.match_id
          WHERE mp.user_id = $1 AND mp.state = 'JOINED' AND m.status = 'ACTIVE' LIMIT 1`,
        [userId]
      );
      if (live[0]) fail("You're already in a live match");

      await c.query(
        `INSERT INTO matchmaking_queue (user_id, mode, size, duration_min)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE
           SET mode = EXCLUDED.mode, size = EXCLUDED.size,
               duration_min = EXCLUDED.duration_min, queued_at = now(), seen_at = now()`,
        [userId, input.mode, size, durationMin]
      );

      return {
        ok: true,
        message:
          input.mode === "DUEL" ? "Searching for an opponent…" : `Searching for ${size} players…`,
      };
    });
  });
}

export async function leaveQueueFor(userId: number): Promise<Res> {
  return guard(async () => {
    await tx(async (c) => {
      await c.query(`DELETE FROM matchmaking_queue WHERE user_id = $1`, [userId]);
    });
    return { ok: true, message: "Search cancelled" };
  });
}

/** Keeps a queued player's seat alive. Called from the polled state endpoint. */
export async function heartbeat(c: PoolClient, userId: number) {
  await c.query(`UPDATE matchmaking_queue SET seen_at = now() WHERE user_id = $1`, [userId]);
}

export type QueueStatus = {
  mode: "DUEL" | "GROUP";
  size: number;
  durationMin: number;
  waiting: number;
  queuedAt: string;
};

/** The player's own queue entry, plus how full their bucket is. */
export async function queueStatusFor(
  c: PoolClient,
  userId: number
): Promise<QueueStatus | null> {
  const { rows } = await c.query(
    `SELECT q.mode, q.size, q.duration_min, q.queued_at,
            (SELECT count(*)::int FROM matchmaking_queue o
              WHERE o.mode = q.mode AND o.size = q.size AND o.duration_min = q.duration_min
                AND o.seen_at > now() - make_interval(secs => $2::int)) AS waiting
       FROM matchmaking_queue q WHERE q.user_id = $1`,
    [userId, QUEUE_TIMEOUT_SECONDS]
  );
  if (!rows[0]) return null;
  return {
    mode: rows[0].mode,
    size: rows[0].size,
    durationMin: rows[0].duration_min,
    waiting: rows[0].waiting,
    queuedAt: rows[0].queued_at,
  };
}

/**
 * Forms every match the queue can currently support.
 *
 * Called from settleDue, so it already holds the settle advisory lock and runs alone. Buckets
 * are filled oldest-first, which is the only fairness guarantee worth making here: wait longer,
 * go sooner. A matchmade match starts immediately rather than sitting in a lobby — queueing is
 * the acceptance, so there is nothing left to accept.
 */
export async function runMatchmakingInTx(c: PoolClient) {
  // Anyone who stopped polling loses their seat rather than blocking the bucket.
  await c.query(
    `DELETE FROM matchmaking_queue WHERE seen_at < now() - make_interval(secs => $1::int)`,
    [QUEUE_TIMEOUT_SECONDS]
  );

  // joinQueue refuses anyone already in a live match, but the two can diverge after the fact: a
  // queued player can accept a username invite and have that match started under them. Left in
  // the queue they would be dealt into a second live match and charged Energy twice. Dropped
  // here rather than at selection time so the bucket counts a player sees are honest too.
  await c.query(
    `DELETE FROM matchmaking_queue q
      WHERE EXISTS (SELECT 1 FROM match_players mp
                      JOIN matches m ON m.id = mp.match_id
                     WHERE mp.user_id = q.user_id AND mp.state = 'JOINED'
                       AND m.status = 'ACTIVE')`
  );

  const { rows: buckets } = await c.query<{
    mode: "DUEL" | "GROUP";
    size: number;
    duration_min: number;
    n: number;
  }>(
    `SELECT mode, size, duration_min, count(*)::int AS n
       FROM matchmaking_queue
      GROUP BY mode, size, duration_min
     HAVING count(*) >= min(size)`
  );

  for (const b of buckets) {
    // A bucket with 7 waiting and a size of 3 forms two matches and leaves one waiting.
    let remaining = b.n;
    while (remaining >= b.size) {
      const formed = await formOne(c, b.mode, b.size, b.duration_min);
      if (!formed) break;
      remaining -= b.size;
    }
  }
}

async function formOne(
  c: PoolClient,
  mode: "DUEL" | "GROUP",
  size: number,
  durationMin: number
): Promise<boolean> {
  const { rows: waiting } = await c.query<{ user_id: number }>(
    `SELECT user_id FROM matchmaking_queue
      WHERE mode = $1 AND size = $2 AND duration_min = $3
      ORDER BY queued_at ASC LIMIT $4 FOR UPDATE`,
    [mode, size, durationMin, size]
  );
  if (waiting.length < size) return false;

  // Charge Energy now, at the moment the match becomes real. Anyone who can no longer pay is
  // dropped from the queue entirely — leaving them in it would stall the bucket every pass.
  const paid: number[] = [];
  for (const w of waiting) {
    const { rows } = await c.query(
      `SELECT energy, energy_capacity, energy_updated_at FROM users WHERE id = $1 FOR UPDATE`,
      [w.user_id]
    );
    if (!rows[0]) continue;
    const a = accrue(rows[0]);
    if (a.energy < CFG.PVP_ENERGY_COST) {
      await c.query(`DELETE FROM matchmaking_queue WHERE user_id = $1`, [w.user_id]);
      continue;
    }
    await c.query(`UPDATE users SET energy = $2, energy_updated_at = $3 WHERE id = $1`, [
      w.user_id,
      a.energy - CFG.PVP_ENERGY_COST,
      a.updatedAt,
    ]);
    paid.push(w.user_id);
  }

  if (paid.length < size) {
    // Someone dropped out between selection and charging. Refund whoever did pay and leave
    // them queued for the next pass rather than starting a match short.
    for (const id of paid) {
      await c.query(`UPDATE users SET energy = energy + $2 WHERE id = $1`, [
        id,
        CFG.PVP_ENERGY_COST,
      ]);
    }
    return false;
  }

  const name =
    mode === "DUEL" ? "Random Duel" : `Random Arena · ${size} players`;
  const { rows: created } = await c.query<{ id: number }>(
    // $4 is cast on both uses: it fills an integer column and feeds an interval, and Postgres
    // cannot deduce a single type for a parameter used two ways (the same 42P08 that once
    // broke sign-up).
    `INSERT INTO matches (name, creator_id, mode, status, duration_min, started_at, ends_at)
     VALUES ($1,$2,$3,'ACTIVE',$4::integer, now(), now() + make_interval(mins => $4::int))
     RETURNING id`,
    [name, paid[0], mode, durationMin]
  );
  const matchId = created[0].id;

  for (const id of paid) {
    await c.query(
      `INSERT INTO match_players (match_id, user_id, state, pvp_opt, pvp_portfolio, joined_at)
       VALUES ($1,$2,'JOINED',$3,0, now())`,
      [matchId, id, CFG.PVP_INITIAL_OPT]
    );
  }

  await c.query(`DELETE FROM matchmaking_queue WHERE user_id = ANY($1::int[])`, [paid]);
  return true;
}
