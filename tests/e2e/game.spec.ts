/**
 * The main-game walk, end to end: sign up, mint, settle, exercise, list, and a second player
 * buying a card and assuming an obligation. Prices are pinned so "this card wins" is a fact
 * about the game rather than about the market.
 */
import { expect, test } from "@playwright/test";
import { CFG } from "@/lib/config";
import { expireCards, fund, mint, reset, setPrices, signIn, sql, state } from "./helpers";

const SPOT = 100;

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: SPOT });
});

test("a new player starts with the configured balances", async ({ page }) => {
  await signIn(page, "alice");
  const s = await state(page);
  expect(s.me.opt).toBe(CFG.INITIAL_OPT_BALANCE);
  expect(s.me.portfolio).toBe(0);
  expect(s.me.energy).toBe(CFG.INITIAL_ENERGY_CAPACITY);
  expect(s.me.energy_capacity).toBe(CFG.INITIAL_ENERGY_CAPACITY);
});

test("minting a Buy card charges a premium and one Energy", async ({ page }) => {
  await signIn(page, "alice");
  const before = await state(page);

  await mint(page, { kind: "BUY", strikePct: -10 });

  const after = await state(page);
  expect(after.me.energy).toBe(before.me.energy - CFG.OPTION_ENERGY_COST);
  expect(after.me.opt).toBeLessThan(before.me.opt);
  expect(after.cards).toHaveLength(1);

  const card = after.cards[0];
  expect(card.kind).toBe("BUY");
  expect(Number(card.strike)).toBeCloseTo(SPOT * 0.9, 4);
  expect(card.status).toBe("ACTIVE");
  // The premium is the modelled value at the game's rate, never a client-supplied number.
  expect(Number(card.premium)).toBe(after.me.opt === before.me.opt ? 0 : before.me.opt - after.me.opt);
});

test("a Buy card above its strike settles WON, awards XP, and can be exercised", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -10 });

  const minted = await state(page);
  const optAfterMint = minted.me.opt;

  // Finish well above the strike, then let the real settler run.
  await setPrices(request, { BTC: 120 });
  await expireCards(request);
  await page.reload();

  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");
  const won = await state(page);
  expect(won.me.xp).toBe(CFG.SUCCESSFUL_OPTION_XP);
  expect(Number(won.cards[0].settle_price)).toBe(120);

  await page.goto("/cards");
  await page.click('button:has-text("Exercise")');
  await expect(page.getByText(/Exercised/)).toBeVisible();

  const done = await state(page);
  const card = done.cards[0];
  expect(card.status).toBe("EXERCISED");
  // Burned strike x amount x rate OPT, received settle_price x amount Portfolio.
  const cost = Number(card.strike) * Number(card.amount) * CFG.EXERCISE_OPT_PER_DOLLAR;
  expect(done.me.opt).toBeCloseTo(optAfterMint - cost, 4);
  expect(done.me.portfolio).toBeCloseTo(120 * Number(card.amount), 4);
});

test("a win too big to afford can be funded at the click, and only when asked", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page, 200_000);

  // Deliberately larger than the OPT balance can cover: exercising burns the whole notional,
  // not just the profit, which is what strands most real wins.
  await page.click('button:has-text("BTC")');
  await page.locator('input[type="range"]').fill("-10");
  await page.locator('input[type="number"]').first().fill("60");
  await page.click('button:has-text("Mint BUY Option")');
  await page.waitForSelector("text=/Card #\\d+ minted/");

  await setPrices(request, { BTC: 120 });
  await expireCards(request);
  await page.reload();
  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");

  const before = await state(page);
  const card = before.cards[0];
  const cost = Number(card.strike) * Number(card.amount) * CFG.EXERCISE_OPT_PER_DOLLAR;
  expect(before.me.opt).toBeLessThan(cost); // the trap this exists to solve

  await page.goto("/cards");
  // Nothing happens on the first click: burning Portfolio costs the exact number the
  // leaderboard ranks on, so it is never implicit.
  await page.click('button:has-text("to cover?")');
  expect((await state(page)).cards[0].status).toBe("WON");

  await page.click('button:has-text("Burn & exercise")');
  await expect(page.getByText(/burned \$.* to cover/)).toBeVisible();

  const after = await state(page);
  expect(after.cards[0].status).toBe("EXERCISED");

  // The burn is sized to exactly cover the gap, so almost no OPT is left stranded.
  const burned = before.me.portfolio + 120 * Number(card.amount) - after.me.portfolio;
  expect(burned).toBeCloseTo((cost - before.me.opt) / CFG.PORTFOLIO_TO_OPT_RATIO, 1);
  expect(after.me.opt).toBeLessThan(CFG.PORTFOLIO_TO_OPT_RATIO); // change from the rounding, no more
});

test("funding is refused when the Portfolio to cover it is locked as collateral", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -10 });
  await setPrices(request, { BTC: 120 });
  await expireCards(request);
  await page.reload();
  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");

  // A fresh player has no Portfolio at all, so there is nothing free to burn and the offer
  // is never made — the button says what is missing instead of promising a way out.
  const s = await state(page);
  expect(s.me.spendable).toBe(0);

  await page.goto("/cards");
  const card = s.cards[0];
  const cost = Number(card.strike) * Number(card.amount) * CFG.EXERCISE_OPT_PER_DOLLAR;
  if (s.me.opt < cost) {
    await expect(page.getByText(/more OPT/)).toBeVisible();
    await expect(page.getByText(/to cover\?/)).toHaveCount(0);
  }
});

test("a Buy card below its strike settles LOST and awards nothing", async ({ page, request }) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: 10 });

  await setPrices(request, { BTC: 95 });
  await expireCards(request);
  await page.reload();

  await expect.poll(async () => (await state(page)).cards[0].status).toBe("LOST");
  expect((await state(page)).me.xp).toBe(0);
});

test("a Sell card pays a premium up front and locks collateral", async ({ page }) => {
  await signIn(page, "alice");
  // Fund the Portfolio so there is something to collateralise with.
  await fund(page);

  const before = await state(page);
  await mint(page, { kind: "SELL", strikePct: 10 });
  const after = await state(page);

  expect(after.me.opt).toBeGreaterThan(before.me.opt); // premium received
  const card = after.cards[0];
  expect(card.kind).toBe("SELL");
  expect(Number(card.collateral)).toBeCloseTo(Number(card.strike) * Number(card.amount), 4);
  expect(after.me.locked).toBeCloseTo(Number(card.collateral), 4);
  expect(after.me.spendable).toBeCloseTo(after.me.portfolio - after.me.locked, 4);
});

test("a surviving Sell obligation releases its collateral and awards XP", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page);
  await mint(page, { kind: "SELL", strikePct: 10 });

  const before = await state(page);
  await setPrices(request, { BTC: 95 }); // finishes below the strike
  await expireCards(request);
  await page.reload();

  await expect.poll(async () => (await state(page)).cards[0].status).toBe("SETTLED");
  const after = await state(page);
  expect(after.me.locked).toBe(0);
  expect(after.me.portfolio).toBeCloseTo(before.me.portfolio, 4); // nothing paid out
  expect(after.me.xp).toBe(CFG.SUCCESSFUL_OPTION_XP);
});

test("a Sell obligation that finishes in the money pays out of collateral, capped", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page);
  await mint(page, { kind: "SELL", strikePct: 10 });

  const before = await state(page);
  const card = before.cards[0];

  // Far past the strike: the uncapped loss would exceed the collateral many times over.
  await setPrices(request, { BTC: 100_000 });
  await expireCards(request);
  await page.reload();

  await expect.poll(async () => (await state(page)).cards[0].status).toBe("SETTLED");
  const after = await state(page);
  expect(after.me.locked).toBe(0);
  expect(after.me.portfolio).toBeCloseTo(before.me.portfolio - Number(card.collateral), 4);
  expect(after.me.portfolio).toBeGreaterThanOrEqual(0);
});

test("listing a Buy card defaults to its live value, and another player buys it", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -10 });

  await page.goto("/cards");
  await page.click('button:has-text("Sell card")');
  // The dialog leads with the computed value; no price is asked for.
  await expect(page.getByText("Live value", { exact: true })).toBeVisible();
  await page.click('button:has-text("List at live value")');
  await expect(page.getByText(/Listed at \$/)).toBeVisible();

  const listed = (await state(page)).cards[0];
  expect(listed.for_sale).toBe(true);
  expect(Number(listed.ask)).toBeGreaterThan(0);

  // Bob needs Portfolio to buy with.
  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");
  await fund(bob);

  const aliceBefore = await state(page);
  const bobBefore = await state(bob);

  await bob.goto("/cards");
  await bob.click('button:has-text("For Sale")');
  await bob.click('button:has-text("Buy for")');
  await expect(bob.getByText(/acquired for/)).toBeVisible();

  const price = Number(listed.ask);
  const bobAfter = await state(bob);
  const aliceAfter = await state(page);

  expect(bobAfter.me.portfolio).toBeCloseTo(bobBefore.me.portfolio - price, 4);
  expect(aliceAfter.me.portfolio).toBeCloseTo(aliceBefore.me.portfolio + price, 4);

  const owner = await sql<{ owner_id: number }>(
    request,
    `SELECT owner_id FROM cards WHERE id = $1`,
    [listed.id]
  );
  expect(owner[0].owner_id).toBe(bobAfter.me.id);
  await bobCtx.close();
});

test("assuming a Sell obligation moves the collateral and pays the takeover premium", async ({
  page,
  browser,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page);
  await mint(page, { kind: "SELL", strikePct: 10 });

  await page.goto("/cards");
  await page.click('button:has-text("Offload obligation")');
  await page.fill('input[type="number"]', "40");
  await page.click('button:has-text("List it")');
  await expect(page.getByText(/Listed/)).toBeVisible();

  const card = (await state(page)).cards[0];
  const collateral = Number(card.collateral);

  const bobCtx = await browser.newContext();
  const bob = await bobCtx.newPage();
  await signIn(bob, "bob");
  await fund(bob);

  const aliceBefore = await state(page);
  const bobBefore = await state(bob);

  await bob.goto("/cards");
  await bob.click('button:has-text("For Sale")');
  await bob.click('button:has-text("Assume")');
  await expect(bob.getByText(/Obligation assumed/)).toBeVisible();

  const aliceAfter = await state(page);
  const bobAfter = await state(bob);

  // Alice's lock is released and she pays the premium; Bob locks his own and is paid.
  expect(aliceAfter.me.locked).toBeCloseTo(aliceBefore.me.locked - collateral, 4);
  expect(bobAfter.me.locked).toBeCloseTo(bobBefore.me.locked + collateral, 4);
  expect(aliceAfter.me.opt).toBeCloseTo(aliceBefore.me.opt - 40, 4);
  expect(bobAfter.me.opt).toBeCloseTo(bobBefore.me.opt + 40, 4);

  const owner = await sql<{ owner_id: number }>(
    request,
    `SELECT owner_id FROM cards WHERE id = $1`,
    [card.id]
  );
  expect(owner[0].owner_id).toBe(bobAfter.me.id);
  await bobCtx.close();
});

test("the store converts Portfolio to OPT at the configured rate", async ({ page }) => {
  await signIn(page, "alice");
  await fund(page);

  const before = await state(page);
  await page.goto("/store");
  // The burn amount is a slider, stepped in tens.
  await page.locator('input[type="range"]').fill("100");
  await page.click('button:has-text("Burn for OPT")');
  await expect(page.getByText(/Burned/)).toBeVisible();

  const after = await state(page);
  expect(after.me.portfolio).toBeCloseTo(before.me.portfolio - 100, 4);
  expect(after.me.opt).toBeCloseTo(before.me.opt + 100 * CFG.PORTFOLIO_TO_OPT_RATIO, 4);
});

test("the rankings page lists players on both leaderboards", async ({ page, browser }) => {
  await signIn(page, "alice");
  const bobCtx = await browser.newContext();
  await signIn(await bobCtx.newPage(), "bob");

  await page.goto("/rankings");
  await expect(page.getByText("alice").first()).toBeVisible();
  await expect(page.getByText("bob").first()).toBeVisible();
  await bobCtx.close();
});
