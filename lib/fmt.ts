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

export function clock(msLeft: number) {
  const s = Math.max(0, Math.floor(msLeft / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const p = (x: number) => String(x).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
