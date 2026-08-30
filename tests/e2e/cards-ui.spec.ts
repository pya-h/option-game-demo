/**
 * The card as an object: its frame, its back, and how a listing is rated.
 *
 * These assert behaviour rather than pixels — that the grade is stable, that the back carries
 * the public record, that a card is never quietly clipped. Rendering can be restyled freely;
 * none of it should break these.
 */
import { expect, test } from "@playwright/test";
import { fund, mint, reset, setPrices, signIn, sql, state } from "./helpers";

const SPOT = 100;

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: SPOT, ETH: SPOT, DOGE: SPOT });
});

/** Mints with an explicit amount, which is what moves a card up the rarity ladder. */
async function mintSized(
  page: import("@playwright/test").Page,
  o: { kind: "BUY" | "SELL"; asset: string; strikePct: number; amount: number }
) {
  await page.click(`button:has-text("${o.asset}")`);
  await page.getByRole("button", { name: o.kind, exact: true }).click();
  await page.locator('input[type="range"]').fill(String(o.strikePct));
  await page.locator('input[type="number"]').first().fill(String(o.amount));
  await page.click(`button:has-text("Mint ${o.kind} Option")`);
  await page.waitForSelector(`text=/Card #\\d+ (minted|written)/`);
}

test("a bigger, bolder card carries a higher grade than a default mint", async ({ page }) => {
  await signIn(page, "alice");
  await fund(page, 500_000);

  await mintSized(page, { kind: "BUY", asset: "BTC", strikePct: 1, amount: 3 }); // $300ish
  await mintSized(page, { kind: "BUY", asset: "DOGE", strikePct: 15, amount: 100 }); // huge, bold

  await page.goto("/cards");
  await page.waitForSelector(".tcg-card");

  // Newest first, so the Legendary DOGE card leads.
  const stars = await page.locator(".tcg-stars").allTextContents();
  const filled = stars.map((s) => (s.match(/★/g) ?? []).length);
  expect(filled[0]).toBeGreaterThan(filled[filled.length - 1]);
});

test("a card's grade does not move when the market does", async ({ page, request }) => {
  await signIn(page, "alice");
  await fund(page, 500_000);
  await mintSized(page, { kind: "BUY", asset: "BTC", strikePct: 10, amount: 40 });

  await page.goto("/cards");
  await page.waitForSelector(".tcg-card");
  const before = await page.locator(".tcg-stars").first().textContent();

  // A card that regraded itself as the price moved would be worthless as a collectible.
  await setPrices(request, { BTC: SPOT * 4 });
  await page.reload();
  await page.waitForSelector(".tcg-card");
  await expect(page.locator(".tcg-stars").first()).toHaveText(before!);
});

test("turning a card over shows its public premium and ownership record", async ({ page }) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -5 });

  await page.goto("/cards");
  await page.waitForSelector(".tcg-card");
  // Both faces are always in the DOM — it's a 3D flip, not a swap — so the tells are the
  // flipped class and the log, which is only fetched once a card is actually turned over.
  await expect(page.locator(".tcg-flip.is-flipped")).toHaveCount(0);
  await expect(page.getByText(/paid \d+ OPT premium/)).toHaveCount(0);

  await page.locator(".tcg-front .tcg-turn").first().click();
  await expect(page.locator(".tcg-flip.is-flipped")).toHaveCount(1);
  await expect(page.getByText("PROVENANCE")).toBeVisible();
  await expect(page.getByText(/paid \d+ OPT premium/)).toBeVisible();

  // And back again — from the back's own button, since the front is now facing away and its
  // controls are genuinely unreachable, which is what a card turned over should feel like.
  await page.locator(".tcg-back .tcg-turn").first().click();
  await expect(page.locator(".tcg-flip.is-flipped")).toHaveCount(0);
});

test("no card clips its own action bar, whatever rows it carries", async ({ page }) => {
  await signIn(page, "alice");
  await fund(page, 500_000);
  // A Sell card carries a collateral row the Buy card doesn't, which is what used to overflow
  // a fixed-height frame and cut the buttons off the bottom.
  await mintSized(page, { kind: "BUY", asset: "BTC", strikePct: 1, amount: 3 });
  await mintSized(page, { kind: "SELL", asset: "ETH", strikePct: 2, amount: 20 });

  await page.goto("/cards");
  await page.waitForSelector(".tcg-card");

  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll(".tcg-front")].map((face) => {
      const foot = face.querySelector(".tcg-actions")!;
      return Math.round(foot.getBoundingClientRect().bottom - face.getBoundingClientRect().bottom);
    })
  );
  expect(overflow.length).toBe(2);
  for (const o of overflow) expect(o).toBeLessThanOrEqual(0);
});

test("the marketplace rates an ask against what the card is actually worth", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -5 });

  // List well under fair value, so the rating has something unambiguous to say.
  const [card] = await sql<{ id: number }>(request, `SELECT id FROM cards ORDER BY id DESC LIMIT 1`);
  await page.goto("/cards");
  await page.click('button:has-text("Sell card")');
  await page.click('button:has-text("Set a custom price")');
  await page.locator('input[type="number"]').fill("1");
  await page.click('button:has-text("List it")');
  await expect(page.getByText(/Listed at \$/)).toBeVisible();

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");
  await bob.goto("/cards");
  await bob.click('button:has-text("For Sale")');

  // The engine says this card is worth far more than $1, so it reads as a bargain.
  await expect(bob.locator("[data-depth]")).toHaveCount(1);
  await expect(bob.locator('[data-depth="under"]')).toBeVisible();

  // And the rating is only ever offered where there is an ask to rate.
  await bob.click('button:has-text("All Cards")');
  await expect(bob.locator("[data-depth]")).toHaveCount(0);

  expect(card.id).toBeGreaterThan(0);
  await bobCtx.close();
});

test("the Energy shop sells capacity, a refill, and both — and the bundle is the cheaper pair", async ({
  page,
}) => {
  await signIn(page, "alice");
  await fund(page, 500_000);
  await page.goto("/store");

  await expect(page.getByText("Energy Cell")).toBeVisible();
  await expect(page.getByText("Capacity Chip")).toBeVisible();
  await expect(page.getByText("Energy Charge")).toBeVisible();

  const cfg = (await state(page)).cfg;
  expect(cfg.energyCellPrices[0]).toBeLessThan(cfg.energyCapacityPrices[0] + cfg.energyChargePrice);
});

test("a Capacity Chip raises the ceiling without refilling the bar", async ({ page, request }) => {
  await signIn(page, "alice");
  await fund(page, 500_000);

  // Spend some Energy first, so a refill would be visible if one happened.
  await mint(page, { kind: "BUY", strikePct: 5 });
  const before = await state(page);
  expect(before.me.energy).toBeLessThan(before.me.energy_capacity);

  await page.goto("/store");
  await page.click('button:has-text("Fit ·")');
  await expect(page.getByText(/capacity upgraded/)).toBeVisible();

  const after = await state(page);
  expect(after.me.energy_capacity).toBe(before.me.energy_capacity + after.cfg.energyCellStep);
  expect(after.me.energy).toBe(before.me.energy); // the ceiling moved, the bar did not

  // The accrual clock is stamped, so the idle time before the upgrade cannot land later.
  const [u] = await sql<{ age: number }>(
    request,
    `SELECT extract(epoch from (now() - energy_updated_at)) AS age FROM users WHERE id = $1`,
    [after.me.id]
  );
  expect(Number(u.age)).toBeLessThan(30);
});

test("an Energy Cell raises the ceiling and charges to it", async ({ page }) => {
  await signIn(page, "alice");
  await fund(page, 500_000);
  await mint(page, { kind: "BUY", strikePct: 5 });

  const before = await state(page);
  await page.goto("/store");
  await page.click('button:has-text("Install ·")');
  await expect(page.getByText(/charged to full/)).toBeVisible();

  const after = await state(page);
  expect(after.me.energy_capacity).toBe(before.me.energy_capacity + after.cfg.energyCellStep);
  expect(after.me.energy).toBe(after.me.energy_capacity);
});
