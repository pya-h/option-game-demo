/**
 * A full PvP match, and the isolation guarantee that makes it worth having: what happens
 * inside a match must never touch a player's global balances, and vice versa.
 */
import { expect, test } from "@playwright/test";
import { CFG } from "@/lib/config";
import { endMatch, fund, reset, setPrices, signIn, sql, state } from "./helpers";

const SPOT = 100;

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: SPOT });
});

test("a match runs from invite to ranked result, and pays the winner a global reward", async ({
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

  // Alice creates and is joined immediately, which is what charges her Energy.
  await page.goto("/pvp");
  await page.click('button:has-text("New Match")');
  // Scoped to the dialog: the Quick Match panel behind it offers the same duration chips.
  const dialog = page.locator("div.panel").filter({ hasText: "Create a match" });
  await page.fill('input[placeholder="BTC Arena"]', "Test Arena");
  await page.fill('input[placeholder="bob"]', "bob");
  await dialog.locator("button.chip", { hasText: /^15m$/ }).click();
  await page.click('button:has-text("Create")');
  await page.waitForURL(/\/pvp\/\d+/);
  const matchId = Number(page.url().split("/").pop());

  expect((await state(page)).me.energy).toBe(aliceBefore.me.energy - CFG.PVP_ENERGY_COST);

  // Bob accepts, which charges his Energy and grants the equal starting balances.
  await bob.goto("/pvp");
  await bob.click('button:has-text("Accept")');
  await expect(bob.getByText(/Joined/)).toBeVisible();
  expect((await state(bob)).me.energy).toBe(bobBefore.me.energy - CFG.PVP_ENERGY_COST);

  const seats = await sql<{ pvp_opt: number; pvp_portfolio: number }>(
    request,
    `SELECT pvp_opt, pvp_portfolio FROM match_players WHERE match_id = $1 AND state = 'JOINED'`,
    [matchId]
  );
  expect(seats).toHaveLength(2);
  for (const s of seats) {
    expect(Number(s.pvp_opt)).toBe(CFG.PVP_INITIAL_OPT);
    expect(Number(s.pvp_portfolio)).toBe(0); // everyone starts equal, whatever they own globally
  }

  // Alice starts it and mints a card that will finish in the money.
  await page.reload();
  await page.click('button:has-text("Start")');
  await expect(page.getByText(/Match started/)).toBeVisible();

  await page.locator('input[type="range"]').fill("-10");
  await page.locator("button.chip", { hasText: /^5m$/ }).click();
  await page.click('button:has-text("Mint BUY Option")');
  await expect(page.getByText(/Card #\d+ minted/)).toBeVisible();

  // A card minted in a match belongs to that match and nowhere else.
  const globalCards = await state(page);
  expect(globalCards.cards).toHaveLength(0);

  await setPrices(request, { BTC: 130 });
  await endMatch(request, matchId);

  const ranked = await sql<{ user_id: number; final_rank: number; pvp_portfolio: number }>(
    request,
    `SELECT user_id, final_rank, pvp_portfolio FROM match_players
      WHERE match_id = $1 AND state = 'JOINED' ORDER BY final_rank`,
    [matchId]
  );
  expect(ranked[0].final_rank).toBe(1);
  expect(ranked[1].final_rank).toBe(2);
  // Alice held the winning position, so she finished with the larger PvP Portfolio.
  expect(Number(ranked[0].pvp_portfolio)).toBeGreaterThan(Number(ranked[1].pvp_portfolio));

  const aliceAfter = await state(page);
  expect(aliceAfter.me.xp).toBe(aliceBefore.me.xp + CFG.PVP_WIN_XP);
  expect(aliceAfter.me.opt).toBe(aliceBefore.me.opt + CFG.PVP_WIN_OPT_REWARD);
  expect(aliceAfter.me.portfolio).toBe(aliceBefore.me.portfolio + CFG.PVP_WIN_PORTFOLIO_REWARD);

  // The loser's global balances are untouched — a match cannot cost you anything but Energy.
  const bobAfter = await state(bob);
  expect(bobAfter.me.opt).toBe(bobBefore.me.opt);
  expect(bobAfter.me.portfolio).toBe(bobBefore.me.portfolio);
  expect(bobAfter.me.xp).toBe(bobBefore.me.xp);

  await bobCtx.close();
});

test("global wealth buys no advantage inside a match", async ({ page, browser, request }) => {
  await signIn(page, "alice");
  await fund(page, 100_000); // alice is rich globally

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob"); // bob is not

  await page.goto("/pvp");
  await page.click('button:has-text("New Match")');
  await page.fill('input[placeholder="bob"]', "bob");
  await page.click('button:has-text("Create")');
  await page.waitForURL(/\/pvp\/\d+/);
  const matchId = Number(page.url().split("/").pop());

  await bob.goto("/pvp");
  await bob.click('button:has-text("Accept")');
  await expect(bob.getByText(/Joined/)).toBeVisible();

  const seats = await sql<{ pvp_opt: number; pvp_portfolio: number }>(
    request,
    `SELECT pvp_opt, pvp_portfolio FROM match_players WHERE match_id = $1 AND state = 'JOINED'`,
    [matchId]
  );
  const distinct = new Set(seats.map((s) => `${Number(s.pvp_opt)}/${Number(s.pvp_portfolio)}`));
  expect(distinct.size).toBe(1);

  await bobCtx.close();
});

test("a non-participant cannot read a match's state", async ({ page, browser }) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");
  const carolCtx = await browser.newContext();
  const carol = await carolCtx.newPage();
  await signIn(carol, "carol");

  await page.goto("/pvp");
  await page.click('button:has-text("New Match")');
  await page.fill('input[placeholder="bob"]', "bob");
  await page.click('button:has-text("Create")');
  await page.waitForURL(/\/pvp\/\d+/);
  const matchId = Number(page.url().split("/").pop());

  const status = (p: import("@playwright/test").Page) =>
    p.evaluate(async (id) => (await fetch(`/api/pvp/${id}/state`)).status, matchId);

  expect(await status(page)).toBe(200); // creator
  expect(await status(bob)).toBe(200); // invited
  expect(await status(carol)).toBe(403); // outsider

  await bobCtx.close();
  await carolCtx.close();
});

test("an option cannot be minted to expire after the final whistle", async ({ page, browser }) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");

  await page.goto("/pvp");
  await page.click('button:has-text("New Match")');
  const dialog = page.locator("div.panel").filter({ hasText: "Create a match" });
  await page.fill('input[placeholder="bob"]', "bob");
  await dialog.locator("button.chip", { hasText: /^5m$/ }).click();
  await page.click('button:has-text("Create")');
  await page.waitForURL(/\/pvp\/\d+/);

  await bob.goto("/pvp");
  await bob.click('button:has-text("Accept")');
  await page.reload();
  await page.click('button:has-text("Start")');
  await expect(page.getByText(/Match started/)).toBeVisible();

  // In a 5-minute match the picker must not offer 15m, 1h or anything longer.
  const chips = await page.locator("button.chip").allTextContents();
  const offered = chips.map((c) => c.trim());
  expect(offered).toContain("1m");
  expect(offered).not.toContain("15m");
  expect(offered).not.toContain("1h");
  expect(offered).not.toContain("1d");

  await bobCtx.close();
});
