import { ASSETS, type AssetSymbol } from "./config";
import { q } from "./db";

const TTL_MS = 15_000;

/**
 * With PRICE_SOURCE=fixed the upstream APIs are never called and price_cache is treated as
 * authoritative however old it is. Tests set prices directly and assert on outcomes that
 * would otherwise depend on the live market; nothing else should ever turn this on.
 */
const FIXED = process.env.PRICE_SOURCE === "fixed";

export type PriceRow = { asset: AssetSymbol; price: number; prev_price: number; updated_at: string };

let inflight: Promise<void> | null = null;

async function fromCoinGecko(): Promise<Record<string, number> | null> {
  const ids = ASSETS.map((a) => a.geckoId).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`;
  const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  const j = (await r.json()) as Record<string, { usd: number }>;
  const out: Record<string, number> = {};
  for (const a of ASSETS) {
    const p = j[a.geckoId]?.usd;
    if (typeof p === "number" && p > 0) out[a.symbol] = p;
  }
  return Object.keys(out).length ? out : null;
}

async function fromCoinLore(): Promise<Record<string, number> | null> {
  const ids = ASSETS.map((a) => a.loreId).join(",");
  const r = await fetch(`https://api.coinlore.net/api/ticker/?id=${ids}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { id: string; price_usd: string }[];
  const bySymbol: Record<string, number> = {};
  for (const row of j ?? []) {
    const a = ASSETS.find((x) => x.loreId === String(row.id));
    const p = parseFloat(row.price_usd);
    if (a && Number.isFinite(p) && p > 0) bySymbol[a.symbol] = p;
  }
  return Object.keys(bySymbol).length ? bySymbol : null;
}

async function refresh() {
  let fresh: Record<string, number> | null = null;
  try {
    fresh = await fromCoinGecko();
  } catch {
    /* fall through */
  }
  if (!fresh) {
    try {
      fresh = await fromCoinLore();
    } catch {
      /* keep last known */
    }
  }
  if (!fresh) return;

  const symbols = Object.keys(fresh);
  const prices = symbols.map((s) => fresh![s]);
  await q(
    `INSERT INTO price_cache (asset, price, prev_price, updated_at)
     SELECT s, p, p, now() FROM unnest($1::text[], $2::numeric[]) AS t(s, p)
     ON CONFLICT (asset) DO UPDATE
       SET prev_price = price_cache.price, price = EXCLUDED.price, updated_at = now()`,
    [symbols, prices]
  );
}

/**
 * Current prices for all tracked assets. Shared 15s cache in price_cache so every
 * polling client hits one upstream request at most, keeping us inside the free tier.
 */
export async function getPrices(): Promise<Record<AssetSymbol, PriceRow>> {
  let rows = await q<PriceRow>(`SELECT * FROM price_cache`);
  const stale =
    !FIXED &&
    (rows.length < ASSETS.length ||
      rows.some((r) => Date.now() - new Date(r.updated_at).getTime() > TTL_MS));

  if (stale) {
    // Collapse concurrent refreshes into one upstream call.
    inflight = inflight ?? refresh().finally(() => (inflight = null));
    await inflight;
    rows = await q<PriceRow>(`SELECT * FROM price_cache`);
  }

  return Object.fromEntries(rows.map((r) => [r.asset, r])) as Record<AssetSymbol, PriceRow>;
}

export async function getPrice(asset: AssetSymbol): Promise<number> {
  const all = await getPrices();
  const p = all[asset]?.price;
  if (!p) throw new Error(`no price for ${asset}`);
  return p;
}
