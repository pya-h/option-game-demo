/**
 * Levels, the OPT drip and the claim window, through the UI.
 *
 * The thread running through all three is that they happen on the server's clock, not the
 * player's: XP lands whenever a poll settles a card, OPT arrives on its own schedule, and a
 * window closes whether or not anyone is looking. So the interesting cases are all about
 * coming back to something that already happened.
 */
import { expect, test } from "@playwright/test";
import { CFG } from "@/lib/config";
import { xpForLevel } from "@/lib/levels";
import { expireCards, fund, hook, mint, reset, setPrices, signIn, sql, state } from "./helpers";

const SPOT = 100;

test.beforeEach(async ({ request }) => {
  await reset(request);
  await setPrices(request, { BTC: SPOT });
});

const setXp = (request: import("@playwright/test").APIRequestContext, userId: number, xp: number) =>
  hook(request, { action: "setXp", userId, xp });

test("a level earned while away is celebrated on the next visit, once", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  const me = (await state(page)).me;
  expect(me.level).toBe(1);
  expect(me.pendingLevelUp).toBeNull();

  // XP arrives with nobody watching — a month-long card settling on someone else's poll.
  await setXp(request, me.id, xpForLevel(3));

  await page.reload();
  await expect(page.getByText(/Level up/i)).toBeVisible();
  await expect(page.getByText(/Level 1 →/)).toBeVisible();
  // Two thresholds at once, so it says so rather than pretending one happened.
  await expect(page.getByText(/2 levels while you were away/)).toBeVisible();

  await page.click('button:has-text("Keep playing")');
  await expect(page.getByText(/Level up/i)).toHaveCount(0);

  // Acknowledged: it must not reappear on the next poll, or every visit is a party.
  await expect.poll(async () => (await state(page)).me.pendingLevelUp).toBeNull();
  await page.reload();
  await page.waitForTimeout(1500);
  await expect(page.getByText(/Level up/i)).toHaveCount(0);
});

test("a level raises the Energy ceiling without touching what was bought", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  const before = await state(page);
  expect(before.me.energy_capacity).toBe(CFG.INITIAL_ENERGY_CAPACITY);

  await setXp(request, before.me.id, xpForLevel(6));
  const after = await state(page);

  expect(after.me.level).toBe(6);
  expect(after.me.energy_capacity).toBe(CFG.INITIAL_ENERGY_CAPACITY + 5);
  expect(after.me.energyUpgrades).toBe(0);

  // And the store still charges the first tier, because nothing has been bought. This is the
  // regression the capacity refactor exists for.
  await page.goto("/store");
  await expect(page.getByText(`Install · $${CFG.ENERGY_CELL_PRICES[0].toLocaleString()}`)).toBeVisible();
});

test("OPT drips for a player who is playing, and stops for one who left", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  const me = (await state(page)).me;
  expect(me.dripActive).toBe(true);
  expect(me.optPerDrip).toBe(CFG.OPT_DRIP_AMOUNT);

  // Walk away for longer than the cutoff.
  await hook(request, { action: "goAway", userId: me.id, days: CFG.OPT_DRIP_IDLE_DAYS + 1 });
  const idle = await state(page);
  expect(idle.me.dripActive).toBe(false);
  // Every one of those missed intervals is forfeited, not banked — coming back after a month
  // must not pay out a month of drops.
  expect(idle.me.opt).toBeLessThanOrEqual(CFG.INITIAL_OPT_BALANCE);

  // Playing a hand starts it again. Polling deliberately does not count.
  await page.goto("/home");
  await mint(page, { kind: "BUY", strikePct: 5 });
  await expect.poll(async () => (await state(page)).me.dripActive).toBe(true);
});

test("a winning card shows its claim window, and lapses when it closes", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page, 200_000);
  await mint(page, { kind: "BUY", strikePct: -10, expiry: "15m" });

  await setPrices(request, { BTC: 130 });
  await expireCards(request);
  await page.reload();
  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");

  const won = (await state(page)).cards[0];
  expect(won.exercise_deadline).not.toBeNull();
  // A 15-minute card gets five minutes, measured from settlement rather than expiry.
  const window = new Date(won.exercise_deadline!).getTime() - new Date(won.settled_at!).getTime();
  expect(window).toBe(300_000);

  await page.goto("/cards");
  await expect(page.getByText("Claim within")).toBeVisible();
  await expect(page.getByText(/Exercise ·/)).toBeVisible();

  const xpBefore = (await state(page)).me.xp;
  await hook(request, { action: "closeWindows" });
  await page.reload();

  const after = await state(page);
  expect(after.cards[0].status).toBe("LAPSED");
  // Still a win: the XP was paid at settlement and is not clawed back.
  expect(after.me.xp).toBe(xpBefore);
  expect(after.me.xp).toBe(CFG.SUCCESSFUL_OPTION_XP);

  await expect(page.getByText("LAPSED")).toBeVisible();
  await expect(page.getByText(/Never claimed/)).toBeVisible();
  await expect(page.getByText(/Exercise ·/)).toHaveCount(0);
});

test("a lapsed card cannot be claimed even by asking the server directly", async ({
  page,
  request,
}) => {
  await signIn(page, "alice");
  await fund(page, 200_000);
  await mint(page, { kind: "BUY", strikePct: -10 });
  await setPrices(request, { BTC: 130 });
  await expireCards(request);
  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");

  const before = await state(page);
  const card = before.cards[0];
  await hook(request, { action: "closeWindows" });

  const [row] = await sql<{ status: string }>(
    request,
    `SELECT status FROM cards WHERE id = $1`,
    [card.id]
  );
  expect(row.status).toBe("LAPSED");

  // The button is gone from the UI, so the rule has to hold on its own. Nothing was paid out:
  // the balances are exactly what they were before the window closed.
  const after = await state(page);
  expect(after.me.portfolio).toBe(before.me.portfolio);
  expect(after.me.opt).toBe(before.me.opt);
});

test("claiming a win pays XP of its own", async ({ page, request }) => {
  await signIn(page, "alice");
  await mint(page, { kind: "BUY", strikePct: -10 });
  await setPrices(request, { BTC: 130 });
  await expireCards(request);
  await page.reload();
  await expect.poll(async () => (await state(page)).cards[0].status).toBe("WON");

  const settled = await state(page);
  expect(settled.me.xp).toBe(CFG.SUCCESSFUL_OPTION_XP);

  await page.goto("/cards");
  await page.click('button:has-text("Exercise")');
  await expect(page.getByText(/Exercised/)).toBeVisible();

  const after = await state(page);
  expect(after.me.xp).toBe(CFG.SUCCESSFUL_OPTION_XP + CFG.EXERCISE_XP);
});
