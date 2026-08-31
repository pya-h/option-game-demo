/**
 * Populates the demo with players and then keeps them playing.
 *
 *   node scripts/simulate.mjs [--users N] [--interval MS] [--seed-only] [--reset]
 *
 * Two passes. The seed pass creates N players and backfills resolved history so the
 * leaderboards aren't flat on first load. The live pass then loops until you stop it (Ctrl-C),
 * picking a few players each tick and having each take one weighted random action.
 *
 * Everything runs through lib/game — the same functions the server actions call — rather than
 * writing rows directly. That matters twice over: the simulation can't reach a state the game
 * itself would reject, and if a rule is broken this script is the thing that trips over it.
 * The only direct SQL is reading state to decide what to do next, and ageing a card's expiry
 * during the seed pass so there is a past to show.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// The game modules are TypeScript with "@/" paths; a tiny loader hook covers both.
register(new URL("./ts-loader.mjs", import.meta.url));

const { CFG, ASSETS, MIN_MATCH_MINUTES } = await import("@/lib/config.ts");
const { pool, q } = await import("@/lib/db.ts");
const { getPrices } = await import("@/lib/prices.ts");
const { settleDue } = await import("@/lib/settle.ts");
const { createCardFor, exerciseCardFor, listCardFor, acquireCardFor } = await import(
  "@/lib/game/cards.ts"
);
const { convertPortfolioToOptFor, buyEnergyChargeFor, buyEnergyCellFor, buyCapacityChipFor } =
  await import("@/lib/game/store.ts");
const { createMatchFor, respondInviteFor, startMatchFor, endMatchNowFor } = await import(
  "@/lib/game/pvp.ts"
);
const { energyCapacity, levelFor } = await import("@/lib/levels.ts");
const { buyDripUpgradeFor } = await import("@/lib/game/store.ts");

// ---------------------------------------------------------------- args

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const USERS = Number(arg("users", 12));
const INTERVAL = Number(arg("interval", 2500));
const SEED_ONLY = flag("seed-only");
const RESET = flag("reset");

// ---------------------------------------------------------------- random

const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
const int = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const chance = (p) => Math.random() < p;

/** Picks by weight: [[value, weight], ...]. */
function weighted(pairs) {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [v, w] of pairs) {
    if ((r -= w) <= 0) return v;
  }
  return pairs[pairs.length - 1][0];
}

const ADJECTIVES = "swift,vivid,lucky,grim,neon,quiet,brass,cobalt,amber,feral,lunar,stoic,rapid,hollow,gilded,rogue,plush,vexed,drifting,candid".split(",");
const NOUNS = "otter,falcon,quartz,ember,badger,marlin,cypress,ronin,harbor,vector,pixel,mantis,cobra,willow,onyx,tundra,zephyr,koi,basalt,lynx".split(",");
const randomName = () =>
  `${pick(ADJECTIVES)}_${pick(NOUNS)}${chance(0.6) ? int(2, 99) : ""}`.slice(0, 20);

// Short expiries dominate so the world visibly resolves while you watch it.
const randomExpiry = () =>
  weighted([
    [60, 30],
    [300, 26],
    [900, 18],
    [3600, 10],
    [21600, 4],
    [86_400, 2],
  ]);

// ---------------------------------------------------------------- logging

const t = () => new Date().toTimeString().slice(0, 8);
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
let actions = 0;

function log(who, what, res) {
  actions++;
  const ok = res?.ok !== false;
  const msg = (res?.message ?? "").replace(/\s+/g, " ").trim();
  console.log(
    `${t()}  ${pad(who, 18)} ${ok ? "·" : "×"} ${pad(what, 10)} ${msg.slice(0, 78)}`
  );
}

// ---------------------------------------------------------------- state reads

const players = async () =>
  q(
    `SELECT id, username, opt, portfolio, locked, energy, energy_upgrades, xp,
            drip_upgrades, opt_updated_at, energy_updated_at, last_active_at
       FROM users ORDER BY id`
  );

const myCards = (id, status) =>
  q(
    `SELECT id, kind, asset, strike, amount, status, for_sale, collateral
       FROM cards WHERE owner_id = $1 AND match_id IS NULL AND status = $2`,
    [id, status]
  );

const listings = (id) =>
  q(
    `SELECT id, kind, ask, collateral FROM cards
      WHERE match_id IS NULL AND for_sale AND status = 'ACTIVE' AND owner_id <> $1`,
    [id]
  );

// ---------------------------------------------------------------- actions

async function actMint(p) {
  const asset = pick(ASSETS).symbol;
  const spot = (await getPrices())[asset]?.price;
  if (!spot) return;

  // Sell options need free Portfolio for collateral, so they only appear once a player has some.
  const free = Number(p.portfolio) - Number(p.locked);
  const kind = free > 500 && chance(0.35) ? "SELL" : "BUY";
  const strikePct = kind === "BUY" ? int(-8, 6) : int(2, 12);
  const seconds = randomExpiry();

  // Scale the position to what they can actually afford rather than always failing rich.
  const notional = kind === "SELL" ? Math.min(free * 0.4, 800) : int(150, 600);
  const amount = Math.max(1e-6, +(notional / spot).toPrecision(4));

  const res = await createCardFor(p.id, { kind, asset, strikePct, amount, seconds });
  log(p.username, res.ok ? `mint ${kind}` : "mint", res);
}

async function actExercise(p) {
  const won = await myCards(p.id, "WON");
  if (!won.length) return false;
  const res = await exerciseCardFor(p.id, pick(won).id);
  log(p.username, "exercise", res);
  return true;
}

async function actList(p) {
  const active = (await myCards(p.id, "ACTIVE")).filter((c) => !c.for_sale);
  if (!active.length) return false;
  const card = pick(active);
  // Buy cards list at their live value by default; a Sell card needs an explicit premium.
  const ask = card.kind === "BUY" ? (chance(0.75) ? null : int(5, 400)) : int(10, 200);
  const res = await listCardFor(p.id, card.id, ask);
  log(p.username, "list", res);
  return true;
}

async function actBuy(p) {
  const open = await listings(p.id);
  if (!open.length) return false;
  const res = await acquireCardFor(p.id, pick(open).id);
  log(p.username, "acquire", res);
  return true;
}

async function actConvert(p) {
  const free = Number(p.portfolio) - Number(p.locked);
  if (free < 50) return false;
  const res = await convertPortfolioToOptFor(p.id, Math.min(free * 0.3, int(50, 400)));
  log(p.username, "convert", res);
  return true;
}

/**
 * Buys something from the Energy shop. Picks across all three so the soak test exercises the
 * capacity paths too — those are the ones that touch the accrual clock, and a bug there is
 * invisible until much later, when the bar refills out of nowhere.
 */
async function actStore(p) {
  const free = Number(p.portfolio) - Number(p.locked);
  const room = Number(p.energy) < energyCapacity(levelFor(Number(p.xp)), Number(p.energy_upgrades));
  const choices = [
    // A Charge on a full bar is refused, so don't offer it — the point is to exercise the
    // paths, not to collect rejections.
    ...(room
      ? [{ name: "recharge", run: () => buyEnergyChargeFor(p.id), cost: CFG.ENERGY_CHARGE_PRICE }]
      : []),
    { name: "chip", run: () => buyCapacityChipFor(p.id), cost: CFG.ENERGY_CAPACITY_PRICES[0] },
    { name: "cell", run: () => buyEnergyCellFor(p.id), cost: CFG.ENERGY_CELL_PRICES[0] },
    { name: "drops", run: () => buyDripUpgradeFor(p.id), cost: CFG.OPT_DRIP_UPGRADE_PRICES[0] },
  ].filter((c) => free >= c.cost);
  if (!choices.length) return false;

  const choice = pick(choices);
  log(p.username, choice.name, await choice.run());
  return true;
}

/** Runs a whole short match start to finish, so the PvP tables and rewards see real traffic. */
async function actMatch(all) {
  const eligible = all.filter((p) => Number(p.energy) >= CFG.PVP_ENERGY_COST);
  if (eligible.length < 2) return;

  const host = pick(eligible);
  const guest = pick(eligible.filter((p) => p.id !== host.id));
  if (!guest) return;

  const created = await createMatchFor(host.id, {
    mode: "DUEL",
    name: `${host.username} vs ${guest.username}`,
    durationMin: MIN_MATCH_MINUTES,
    usernames: [guest.username],
  });
  log(host.username, "match", created);
  if (!created.ok || !created.matchId) return;

  const id = created.matchId;
  log(guest.username, "accept", await respondInviteFor(guest.id, id, true));
  const started = await startMatchFor(host.id, id);
  log(host.username, "start", started);
  if (!started.ok) return;

  // Both players take a position, then the host calls it early so the match resolves
  // while the simulation is still watching.
  for (const p of [host, guest]) {
    const asset = pick(ASSETS).symbol;
    const spot = (await getPrices())[asset]?.price;
    if (!spot) continue;
    const res = await createCardFor(p.id, {
      kind: "BUY",
      asset,
      strikePct: int(-6, 4),
      amount: +(int(200, 600) / spot).toPrecision(4),
      seconds: 60,
      matchId: id,
    });
    log(p.username, "pvp mint", res);
  }

  log(host.username, "end", await endMatchNowFor(host.id, id));
}

// ---------------------------------------------------------------- passes

async function ensurePlayers() {
  const existing = await players();
  const missing = USERS - existing.length;
  if (missing <= 0) return existing;

  const names = new Set(existing.map((p) => p.username.toLowerCase()));
  for (let i = 0; i < missing; i++) {
    let name = randomName();
    while (names.has(name.toLowerCase())) name = randomName();
    names.add(name.toLowerCase());
    await q(
      // Capacity is derived from level and purchases now, so a new player only needs a
      // starting bar — there is no capacity column to seed.
      `INSERT INTO users (username, opt, portfolio, energy, energy_updated_at)
       VALUES ($1, $2, 0, $3::numeric, now())`,
      [name, CFG.INITIAL_OPT_BALANCE, CFG.INITIAL_ENERGY_CAPACITY]
    );
    console.log(`${t()}  + ${name}`);
  }
  return players();
}

/**
 * Gives the leaderboards a past. Each player mints a few cards through the real rules, then the
 * cards are aged so the real settler resolves them — the same path a card takes when its clock
 * simply runs out.
 */
async function seed() {
  console.log(`\n— seeding ${USERS} players —\n`);
  let all = await ensurePlayers();

  for (let round = 0; round < 3; round++) {
    for (const p of all) {
      if (chance(0.75)) await actMint(p);
    }
    // Age everything and let the settler run for real.
    await q(`UPDATE cards SET expires_at = now() - interval '1 second' WHERE status = 'ACTIVE'`);
    await settleDue();
    all = await players();

    // Cash in some of the wins, so Portfolio and the rankings aren't all zero.
    for (const p of all) {
      if (chance(0.6)) await actExercise(p);
    }
    all = await players();
  }
  console.log(`\n— seeded · ${actions} actions —\n`);
}

/**
 * What this player could plausibly do right now, with weights.
 *
 * Choosing the action first and discovering afterwards that the player has nothing to
 * exercise or list would silently collapse the whole mix into minting — most players hold no
 * winning card at any given moment. So the options are narrowed to what is actually available
 * before anything is weighted.
 */
async function optionsFor(p) {
  const free = Number(p.portfolio) - Number(p.locked);
  const [won, listable, open] = await Promise.all([
    myCards(p.id, "WON"),
    myCards(p.id, "ACTIVE"),
    listings(p.id),
  ]);
  const unlisted = listable.filter((c) => !c.for_sale);

  const opts = [[actMint, 34]];
  if (won.length) opts.push([actExercise, 24]);
  if (unlisted.length) opts.push([actList, 18]);
  if (open.length && free > 50) opts.push([actBuy, 16]);
  if (free > 50) opts.push([actConvert, 10]);
  // Affording the cheapest thing on the shelf is enough — actStore picks among whatever the
  // player can actually buy, so capacity upgrades get exercised as well as refills.
  if (free > Math.min(CFG.ENERGY_CHARGE_PRICE, CFG.ENERGY_CAPACITY_PRICES[0]))
    opts.push([actStore, 6]);
  return opts;
}

async function tick() {
  await settleDue();
  const all = await players();
  if (!all.length) return;

  if (chance(0.12)) {
    await actMatch(all);
    return;
  }

  const active = int(1, Math.max(1, Math.ceil(all.length / 4)));
  for (let i = 0; i < active; i++) {
    const p = pick(all);
    await weighted(await optionsFor(p))(p);
  }
}

// ---------------------------------------------------------------- main

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) process.exit(1);
  stopping = true;
  console.log(`\n— stopping · ${actions} actions —`);
});

if (RESET) {
  await q(`TRUNCATE card_events, cards, match_players, matches, users RESTART IDENTITY CASCADE`);
  console.log("cleared existing players and cards");
}

await seed();

if (!SEED_ONLY) {
  console.log(`— live · one tick every ${INTERVAL}ms · Ctrl-C to stop —\n`);
  while (!stopping) {
    try {
      await tick();
    } catch (e) {
      console.error(`${t()}  ! ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }
}

await pool.end();
