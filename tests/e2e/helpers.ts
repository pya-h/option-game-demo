import type { Page, APIRequestContext } from "@playwright/test";

/** Calls the env-gated test hooks in app/api/e2e. */
export async function hook(req: APIRequestContext, body: Record<string, unknown>) {
  const r = await req.post("/api/e2e", { data: body });
  if (!r.ok()) throw new Error(`e2e hook ${JSON.stringify(body)} failed: ${r.status()} ${await r.text()}`);
  return r.json();
}

export const reset = (req: APIRequestContext) => hook(req, { action: "reset" });
export const setPrices = (req: APIRequestContext, prices: Record<string, number>) =>
  hook(req, { action: "setPrices", prices });
export const expireCards = (req: APIRequestContext, cardIds?: number[]) =>
  hook(req, { action: "expireCards", cardIds });
export const endMatch = (req: APIRequestContext, matchId: number) =>
  hook(req, { action: "endMatch", matchId });

export async function sql<T = Record<string, unknown>>(
  req: APIRequestContext,
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  return (await hook(req, { action: "sql", text, params })).rows as T[];
}

/** Signs up (or resumes) and waits for the game shell to be live. */
export async function signIn(page: Page, username: string) {
  await page.goto("/");
  await page.fill('input[name="username"]', username);
  await page.click('button:has-text("Enter the Arena")');
  await page.waitForURL("**/home");
  // The shell renders from the polled state, so wait for the first payload to land.
  await page.waitForSelector('button:has-text("Mint")');
}

/**
 * Reads the polled state payload for this page's session.
 *
 * Goes through the page's request context rather than an in-page fetch: matchmaking navigates
 * the page the moment a match forms, which would cancel an in-flight fetch and surface as a
 * truncated body rather than as the state we asked for.
 */
export async function state(page: Page) {
  const r = await page.request.get("/api/state");
  if (!r.ok()) throw new Error(`/api/state returned ${r.status()}: ${await r.text()}`);
  return r.json();
}

/**
 * Mints a card through the real UI. `strikePct` drives the slider, so the strike lands at
 * that offset from the pinned spot.
 */
export async function mint(
  page: Page,
  opts: { kind: "BUY" | "SELL"; asset?: string; strikePct: number; expiry?: string }
) {
  const { kind, asset = "BTC", strikePct, expiry = "15m" } = opts;
  await page.click(`button:has-text("${asset}")`);
  await page.getByRole("button", { name: kind, exact: true }).click();
  await page.locator('input[type="range"]').fill(String(strikePct));
  await page.locator("button.chip", { hasText: new RegExp(`^${expiry}$`) }).click();
  await page.click(`button:has-text("Mint ${kind} Option")`);
  await page.waitForSelector(`text=/Card #\\d+ (minted|written)/`);
}

/** Gives the signed-in player Portfolio to work with, the way a settled win would. */
export async function fund(page: Page, amount = 5000) {
  await page.evaluate(async (amt) => {
    const s = await (await fetch("/api/state")).json();
    await fetch("/api/e2e", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "fund", userId: s.me.id, amount: amt }),
    });
  }, amount);
  await page.reload();
  await page.waitForSelector('nav a, button');
}
