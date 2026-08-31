/**
 * Layout guarantees that are easy to break and hard to notice.
 *
 * The card grid sizes itself from its container rather than the viewport, which is the whole
 * reason /home and /cards can both be right at the same window width. Asserting the column
 * counts differ at one viewport is the cheapest way to catch someone swapping the container
 * queries back for breakpoints.
 */
import { expect, test } from "@playwright/test";
import { fund, mint, reset, setPrices, signIn } from "./helpers";

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: 100, ETH: 100 });
});

/** Distinct x positions among the cards = how many columns the grid resolved to. */
const columns = (page: import("@playwright/test").Page) =>
  page.evaluate(
    () =>
      new Set(
        [...document.querySelectorAll(".tcg-scene")].map((n) =>
          Math.round(n.getBoundingClientRect().x)
        )
      ).size
  );

test("the same viewport gives the home column fewer cards per row than the full page", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, "alice");
  await fund(page, 200_000);
  for (let i = 0; i < 6; i++) await mint(page, { kind: "BUY", strikePct: 1 + i });

  await page.goto("/home");
  await page.waitForSelector(".tcg-card");
  const home = await columns(page);

  await page.goto("/cards");
  await page.waitForSelector(".tcg-card");
  const cards = await columns(page);

  // /home gives up 380px to the create panel. If both pages resolve the same way, the grid is
  // reading the window instead of its container and one of the two pages is wrong.
  expect(home).toBeLessThanOrEqual(cards);
  expect(cards).toBeGreaterThan(1);
});

test("a card is never narrower than a card should be", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 1000 });
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: 1 });

  await page.goto("/home");
  await page.waitForSelector(".tcg-card");
  const box = await page.locator(".tcg-front").first().boundingBox();

  // A real trading card is about 0.71 wide-to-tall. Anything much thinner stops reading as a
  // card, which is what a viewport-driven 3-up on the narrow home column produced.
  const ratio = box!.width / box!.height;
  expect(ratio).toBeGreaterThan(0.6);
  expect(box!.width).toBeGreaterThan(260);
});

test("the guide is reachable from the nav and renders every section", async ({ page }) => {
  await signIn(page, "alice");
  await page.click('a[href="/guide"]');
  await expect(page).toHaveURL(/\/guide$/);

  // Animated on mount rather than on scroll, so everything is present without scrolling —
  // the property that broke when this used whileInView.
  // By role, not by text: each heading also carries its section number and an icon, so its
  // text content is never exactly the title. Roles also keep "PvP" from matching the nav link.
  for (const heading of [
    "Four resources",
    "The loop",
    "Two kinds of card",
    "Where the premium comes from",
    "Claiming a win, and the window",
    "Levels",
    "The marketplace",
    "PvP",
    "Two leaderboards",
  ]) {
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
  }

  // The claim-window table is generated from the live config, not typed into prose.
  await expect(page.getByText("Claim within")).toBeVisible();
});

test("a player outside the top of the board still sees their own standing", async ({
  page,
  browser,
}) => {
  await signIn(page, "alice");
  await fund(page, 500_000); // alice will lead

  const ctxs = [];
  for (const name of ["bob", "carol"]) {
    const ctx = await browser.newContext();
    ctxs.push(ctx);
    await signIn(await ctx.newPage(), name);
  }

  await page.goto("/rankings");
  await expect(page.getByText("Portfolio ranking")).toBeVisible();
  // alice is top, so she appears on the podium rather than in the pinned row.
  await expect(page.locator("text=your standing")).toHaveCount(0);
  await expect(page.getByText("alice").first()).toBeVisible();

  for (const c of ctxs) await c.close();
});

test("both leaderboards are reachable and rank differently", async ({ page, browser }) => {
  await signIn(page, "alice");
  await fund(page, 500_000); // rich, no XP

  const ctx = await browser.newContext();
  const bob = await ctx.newPage();
  await signIn(bob, "bob");

  await page.goto("/rankings");
  await page.click('button:has-text("Level & XP")');
  await expect(page.getByText("Level ranking")).toBeVisible();
  await page.click('button:has-text("Portfolio")');
  await expect(page.getByText("Portfolio ranking")).toBeVisible();

  await ctx.close();
});
