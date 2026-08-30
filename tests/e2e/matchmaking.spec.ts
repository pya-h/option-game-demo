/**
 * Random matchmaking. The interesting behaviour isn't that two searching players get a game —
 * it's the edges: buckets that must not mix, Energy charged only on forming, and a player who
 * walks away not holding a seat forever.
 */
import { expect, test } from "@playwright/test";
import { CFG } from "@/lib/config";
import { reset, setPrices, signIn, sql, state } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: 100 });
});

/** Nudges the settle pass, which is what drains the queue. */
const drain = (page: import("@playwright/test").Page) => page.request.get("/api/state");

test("two players searching for a 1v1 are matched and dropped into a live match", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");

  const aliceBefore = await state(page);
  const bobBefore = await state(bob);

  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');
  await expect(page.getByText(/Finding an opponent/)).toBeVisible();

  // Searching alone costs nothing — Energy is charged when the match forms.
  await drain(page);
  expect((await state(page)).me.energy).toBe(aliceBefore.me.energy);
  expect((await state(page)).queue?.mode).toBe("DUEL");

  await bob.goto("/pvp");
  await bob.click('button:has-text("Find opponent")');

  // The next poll drains the queue and forms the match.
  await expect.poll(async () => (await state(page)).queue).toBeNull();
  await expect.poll(async () => (await state(bob)).queue).toBeNull();

  const matchId = (await state(page)).liveMatchId;
  expect(matchId).not.toBeNull();
  expect((await state(bob)).liveMatchId).toBe(matchId);

  // Now that it formed, both were charged.
  expect((await state(page)).me.energy).toBe(aliceBefore.me.energy - CFG.PVP_ENERGY_COST);
  expect((await state(bob)).me.energy).toBe(bobBefore.me.energy - CFG.PVP_ENERGY_COST);

  // It starts live — queueing was the acceptance, so there is nothing left to accept.
  const [m] = await sql<{ status: string; ends_at: string }>(
    request,
    `SELECT status, ends_at FROM matches WHERE id = $1`,
    [matchId]
  );
  expect(m.status).toBe("ACTIVE");
  expect(new Date(m.ends_at).getTime()).toBeGreaterThan(Date.now());

  const seats = await sql<{ state: string; pvp_opt: number }>(
    request,
    `SELECT state, pvp_opt FROM match_players WHERE match_id = $1`,
    [matchId]
  );
  expect(seats).toHaveLength(2);
  for (const s of seats) {
    expect(s.state).toBe("JOINED");
    expect(Number(s.pvp_opt)).toBe(CFG.PVP_INITIAL_OPT);
  }

  // The searching player is taken to their match without clicking anything.
  await page.waitForURL(new RegExp(`/pvp/${matchId}$`));
  await bobCtx.close();
});

test("players who asked for different group sizes never match each other", async ({
  page,
  browser,
}) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");

  // Alice wants a 3-player game, Bob wants 4. Neither bucket can fill.
  for (const [p, size] of [
    [page, "3"],
    [bob, "4"],
  ] as const) {
    await p.goto("/pvp");
    await p.click('button:has-text("Group")');
    await p.locator("button.chip", { hasText: new RegExp(`^${size}$`) }).click();
    await p.click(`button:has-text("Find ${size} players")`);
    await expect(p.getByText(/Finding \d+ players/)).toBeVisible();
  }

  await drain(page);
  await drain(bob);

  // Both are still searching, and each sees only itself waiting.
  const a = await state(page);
  const b = await state(bob);
  expect(a.queue?.size).toBe(3);
  expect(b.queue?.size).toBe(4);
  expect(a.queue?.waiting).toBe(1);
  expect(b.queue?.waiting).toBe(1);
  expect(a.liveMatchId).toBeNull();
  expect(b.liveMatchId).toBeNull();

  await bobCtx.close();
});

test("a group match forms only once the bucket is full", async ({ page, browser }) => {
  const ctxs = [];
  const pages = [page];
  await signIn(page, "alice");
  for (const name of ["bob", "carol"]) {
    const ctx = await browser.newContext();
    ctxs.push(ctx);
    const p = await ctx.newPage();
    await signIn(p, name);
    pages.push(p);
  }

  // First two queue for a 3-player game: not enough.
  for (const p of pages.slice(0, 2)) {
    await p.goto("/pvp");
    await p.click('button:has-text("Group")');
    await p.locator("button.chip", { hasText: /^3$/ }).click();
    await p.click('button:has-text("Find 3 players")');
  }
  await drain(pages[0]);
  expect((await state(pages[0])).queue?.waiting).toBe(2);
  expect((await state(pages[0])).liveMatchId).toBeNull();

  // The third completes it.
  await pages[2].goto("/pvp");
  await pages[2].click('button:has-text("Group")');
  await pages[2].locator("button.chip", { hasText: /^3$/ }).click();
  await pages[2].click('button:has-text("Find 3 players")');

  for (const p of pages) {
    await expect.poll(async () => (await state(p)).queue).toBeNull();
    expect((await state(p)).liveMatchId).not.toBeNull();
  }
  const ids = await Promise.all(pages.map(async (p) => (await state(p)).liveMatchId));
  expect(new Set(ids).size).toBe(1);

  for (const c of ctxs) await c.close();
});

test("cancelling a search leaves the queue and charges nothing", async ({ page }) => {
  await signIn(page, "alice");
  const before = await state(page);

  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');
  await expect(page.getByText(/Finding an opponent/)).toBeVisible();

  await page.click('button:has-text("Cancel search")');
  await expect(page.getByText(/Find opponent/)).toBeVisible();

  const after = await state(page);
  expect(after.queue).toBeNull();
  expect(after.me.energy).toBe(before.me.energy);
});

test("searching again replaces the previous entry rather than queueing twice", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await page.goto("/pvp");

  await page.click('button:has-text("Find opponent")');
  await expect(page.getByText(/Finding an opponent/)).toBeVisible();
  await page.click('button:has-text("Cancel search")');

  await page.click('button:has-text("Group")');
  await page.locator("button.chip", { hasText: /^4$/ }).click();
  await page.click('button:has-text("Find 4 players")');
  await expect(page.getByText(/Finding 4 players/)).toBeVisible();

  const rows = await sql<{ n: number }>(
    request,
    `SELECT count(*)::int AS n FROM matchmaking_queue WHERE user_id = $1`,
    [(await state(page)).me.id]
  );
  expect(Number(rows[0].n)).toBe(1);
  expect((await state(page)).queue?.size).toBe(4);
});

test("a player who stops polling ages out instead of blocking the bucket", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page, "alice");
  const ghostCtx = await browser.newContext();
  const ghost = await ghostCtx.newPage();
  await signIn(ghost, "ghost");

  await ghost.goto("/pvp");
  await ghost.click('button:has-text("Find opponent")');
  await expect(ghost.getByText(/Finding an opponent/)).toBeVisible();

  // The ghost closes their tab, so nothing refreshes their seat again.
  await ghostCtx.close();

  // Age their heartbeat past the timeout, the way real time would.
  await agedOut(request);

  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');
  await drain(page);

  // Alice is alone: the ghost's seat is gone rather than pairing her with a dead client.
  expect((await state(page)).queue?.waiting).toBe(1);
  expect((await state(page)).liveMatchId).toBeNull();
});

/** Pushes every queued heartbeat past the timeout so the next drain evicts them. */
async function agedOut(request: import("@playwright/test").APIRequestContext) {
  await request.post("/api/e2e", { data: { action: "ageQueue" } });
}
