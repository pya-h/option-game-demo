/**
 * Test-only control surface, mounted solely for the end-to-end suite.
 *
 * Two things make the game hard to test honestly: prices come from a live market, and
 * settlement is driven by wall-clock expiry. Rather than sleeping and hoping, the suite pins
 * prices and pulls a card's expiry into the past, then lets the real settler run.
 *
 * Every route here returns 404 unless E2E_HOOKS=1, so it does not exist in a normal build.
 * Point it at a throwaway database: `reset` truncates every table.
 */
import { NextResponse } from "next/server";
import { ASSETS } from "@/lib/config";
import { q } from "@/lib/db";
import { settleDue } from "@/lib/settle";

export const dynamic = "force-dynamic";

const ENABLED = process.env.E2E_HOOKS === "1";
const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function POST(req: Request) {
  if (!ENABLED) return notFound();
  const body = await req.json().catch(() => ({}));

  switch (body.action) {
    case "reset": {
      await q(`TRUNCATE matchmaking_queue, card_events, cards, match_players, matches, price_cache, users RESTART IDENTITY CASCADE`);
      return NextResponse.json({ ok: true });
    }

    case "setPrices": {
      // { prices: { BTC: 100000, ETH: 4000 } } — absent assets keep a default so getPrices
      // always has a full set and the settler never skips a card for want of a quote.
      const given: Record<string, number> = body.prices ?? {};
      const symbols: string[] = [];
      const values: number[] = [];
      for (const a of ASSETS) {
        symbols.push(a.symbol);
        values.push(given[a.symbol] ?? 100);
      }
      await q(
        `INSERT INTO price_cache (asset, price, prev_price, updated_at)
         SELECT s, p, p, now() FROM unnest($1::text[], $2::numeric[]) AS t(s, p)
         ON CONFLICT (asset) DO UPDATE
           SET prev_price = price_cache.price, price = EXCLUDED.price, updated_at = now()`,
        [symbols, values]
      );
      return NextResponse.json({ ok: true });
    }

    case "fund": {
      // Gives a player Portfolio the way a settled win would, so a spec can get to the parts
      // that need spending power without first playing a whole card through.
      await q(`UPDATE users SET portfolio = portfolio + $2 WHERE id = $1`, [
        body.userId,
        body.amount ?? 5000,
      ]);
      return NextResponse.json({ ok: true });
    }

    case "expireCards": {
      // Move expiry into the past instead of waiting for it. Settlement still runs for real.
      const ids: number[] = body.cardIds ?? [];
      if (ids.length) {
        await q(`UPDATE cards SET expires_at = now() - interval '1 second' WHERE id = ANY($1::int[])`, [ids]);
      } else {
        await q(`UPDATE cards SET expires_at = now() - interval '1 second' WHERE status = 'ACTIVE'`);
      }
      await settleDue();
      return NextResponse.json({ ok: true });
    }

    case "endMatch": {
      await q(`UPDATE matches SET ends_at = now() - interval '1 second' WHERE id = $1`, [body.matchId]);
      await settleDue();
      return NextResponse.json({ ok: true });
    }

    case "ageQueue": {
      // Pushes every queued heartbeat past the timeout, so a spec can test eviction without
      // waiting out the real clock.
      await q(`UPDATE matchmaking_queue SET seen_at = now() - interval '1 hour'`);
      await settleDue();
      return NextResponse.json({ ok: true });
    }

    case "settle": {
      await settleDue();
      return NextResponse.json({ ok: true });
    }

    case "sql": {
      // Read-only escape hatch so a spec can assert on state the UI doesn't show.
      if (!/^\s*select/i.test(body.text ?? "")) {
        return NextResponse.json({ error: "select only" }, { status: 400 });
      }
      return NextResponse.json({ rows: await q(body.text, body.params ?? []) });
    }

    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
