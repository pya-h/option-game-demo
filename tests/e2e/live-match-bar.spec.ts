/**
 * The strip that follows a player around the app while they're searching or playing.
 *
 * The queue is drained by whichever request happens to be polling, so a match can form while
 * the player is on any page. Before this existed, it formed silently: Energy was charged and a
 * clock started with nothing on screen to say so.
 */
import { expect, test } from "@playwright/test";
import { CFG } from "@/lib/config";
import { reset, setPrices, signIn, state } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: 100 });
});

test("searching is visible from anywhere, and never doubled up on the PvP page", async ({
  page,
}) => {
  await signIn(page, "alice");
  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');

  // On /pvp the Quick Match panel owns the status, so the bar stays out of its way.
  await expect(page.getByText(/Finding an opponent/)).toHaveCount(1);

  // Everywhere else the bar is the only thing that would tell them.
  await page.click('a[href="/store"]');
  await expect(page.getByText(/Finding an opponent/)).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Cancel/ })).toBeVisible();

  await page.click('a[href="/home"]');
  await expect(page.getByText(/Finding an opponent/)).toBeVisible();
});

test("cancelling from the bar leaves the queue", async ({ page }) => {
  await signIn(page, "alice");
  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');

  await page.click('a[href="/rankings"]');
  await page.getByRole("button", { name: /Cancel/ }).click();

  await expect(page.getByText(/Finding an opponent/)).toHaveCount(0);
  expect((await state(page)).queue).toBeNull();
});

test("a match that forms while the player is elsewhere still takes them to it", async ({
  page,
  browser,
}) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");

  await page.goto("/pvp");
  await page.click('button:has-text("Find opponent")');
  // Alice wanders off to read the leaderboard while she waits.
  await page.click('a[href="/rankings"]');
  await expect(page.getByText(/Finding an opponent/)).toBeVisible();

  await bob.goto("/pvp");
  await bob.click('button:has-text("Find opponent")');

  // She is carried into the arena without ever going back to /pvp.
  await page.waitForURL(/\/pvp\/\d+$/, { timeout: 30_000 });
  const matchId = Number(page.url().split("/").pop());
  expect((await state(bob)).liveMatchId).toBe(matchId);

  await bobCtx.close();
});

test("a live match keeps a way back into it from every other page", async ({ page, browser }) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");

  for (const p of [page, bob]) {
    await p.goto("/pvp");
    await p.click('button:has-text("Find opponent")');
  }
  await page.waitForURL(/\/pvp\/\d+$/, { timeout: 30_000 });
  const url = page.url();

  // Inside the room the room is the status, so the bar keeps quiet.
  await expect(page.getByText(/You're in a live match/)).toHaveCount(0);

  await page.goto("/home");
  await expect(page.getByText(/You're in a live match/)).toBeVisible();
  await page.click('text=Enter arena');
  await expect(page).toHaveURL(url);

  await bobCtx.close();
});

test("a random match charges Energy once, when it forms", async ({ page, browser }) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");
  const before = (await state(page)).me.energy;

  for (const p of [page, bob]) {
    await p.goto("/pvp");
    await p.click('button:has-text("Find opponent")');
  }
  await page.waitForURL(/\/pvp\/\d+$/, { timeout: 30_000 });

  // Not twice, and not once for searching and again for forming.
  expect((await state(page)).me.energy).toBe(before - CFG.PVP_ENERGY_COST);

  await bobCtx.close();
});
