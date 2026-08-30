export const usd = (n: number, dp = 2) =>
  "$" +
  Number(n ?? 0).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

export const usdc = (n: number) =>
  "$" + Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const opt = (n: number) =>
  Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 }) + " OPT";

export const num = (n: number, dp = 2) =>
  Number(n ?? 0).toLocaleString("en-US", { maximumFractionDigits: dp });

/** Price formatting that stays readable for both BTC and DOGE. */
export const price = (n: number) => {
  const v = Number(n ?? 0);
  const dp = v >= 1000 ? 0 : v >= 1 ? 2 : 5;
  return "$" + v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
};

export const amt = (n: number) => {
  const v = Number(n ?? 0);
  return v.toLocaleString("en-US", { maximumFractionDigits: v >= 100 ? 0 : 6 });
};

/** Compact duration label — "45s", "15m", "2h 30m", "3d". Used for expiry and match length. */
export function duration(seconds: number) {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  if (s < 604800) {
    const d = Math.floor(s / 86400);
    const h = Math.round((s % 86400) / 3600);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (s < 2592000) return `${Math.round(s / 604800)}w`;
  return `${Math.round(s / 2592000)}mo`;
}

export function clock(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
