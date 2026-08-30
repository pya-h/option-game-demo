# 🎴 OPT — Options Trading Arena

A gamified options-trading game. Players mint collectible **option cards** against live crypto
prices, trade them with each other, write collateralised sell options, and compete on two
leaderboards — plus isolated PvP arenas where everyone starts equal.

> **Nothing here is real.** No wallets, no chain, no real money, no crypto ownership. Real market
> prices are used only as the external reference that decides whether an option wins. Every
> balance in the game is virtual.

This is a demo build of the concept in [`.stuff/IDEA.md`](.stuff/IDEA.md).

---

## The idea in brief

Four resources drive everything:

| Resource | What it is |
|---|---|
| **OPT** | The currency. Pays premiums on Buy Options, is earned by writing Sell Options, and is burned to exercise a win. |
| **Portfolio** | Virtual dollar value — both your **score** and your **purchasing power**. Buys cards from other players, collateralises Sell Options, and buys Energy. |
| **Energy** | Throttles how many options you can mint. Regenerates over time; entering PvP costs a chunk. |
| **XP** | Pure progression. A correct option awards XP **even if you never exercise it**. |

**The loop:** spend Energy + OPT to mint a card → keep it or list it on the marketplace → the market
moves → the card expires → correct calls pay XP → exercise to convert the win into Portfolio →
spend Portfolio on cards, Energy or more OPT → compete.

The tension is that Portfolio is the thing you're ranked on *and* the thing you spend. Every
purchase costs you leaderboard position.

### Card types

- **Buy Option** — pay an OPT premium for the right to buy above a strike. Wins if the price
  finishes above it. Selling the card transfers ownership for Portfolio Value.
- **Sell Option** — earn an OPT premium for taking on an obligation, backed by locked Portfolio
  collateral (`strike × amount`). If the price finishes above the strike you pay out of that
  collateral. Transferring the card hands over the *obligation*: the new owner locks their own
  collateral and collects a takeover premium from you. The full premium history is public.

### PvP

A match is a sealed economy. Everyone gets identical starting PvP OPT and $0 PvP Portfolio, so
months of progress buy no advantage. Entry costs main-game Energy; inside the match Energy doesn't
exist and OPT is the only limit. PvP cards and the PvP marketplace never touch the global ones.
Ranking is by final PvP Portfolio, and the winner takes a small, fixed global reward so a big match
can't distort the main economy.

---

## Stack

- **Next.js 15** (App Router, TypeScript) — one process for UI, API and mutations
- **PostgreSQL** via `pg` with hand-written SQL — every transfer runs in a transaction with
  `SELECT … FOR UPDATE` row locks
- **Tailwind v4** + **framer-motion** + **lucide-react**
- **CoinGecko** for prices (free, no key), falling back to **CoinLore**

Live data is client polling every 5s (3s inside a match). Expired options are resolved lazily at
the top of the read endpoints under a Postgres advisory lock — no cron job, no worker process.

---

## Setup

**Requires:** Node 20+, a PostgreSQL database, and outbound internet for the price API.

```bash
# 1. install
pnpm install          # or npm install

# 2. configure — set DATABASE_URL to your Postgres instance
cp .env.example .env  # if .env isn't already present, then edit it

# 3. create the schema (drops and recreates every table)
pnpm db:push

# 4. run
pnpm dev              # http://localhost:3000
```

Sign in with any username — no password. The account is created on first use, and typing the same
name again resumes it. To try trading or PvP, open a second browser profile (or an incognito
window) and sign in as another player.

For production: `pnpm build && pnpm start`.

---

## Configuration

Every balance-affecting number lives in `.env` (defaults in [`lib/config.ts`](lib/config.ts)):

```env
# --- OPT / economy ---
INITIAL_OPT_BALANCE=10000
PORTFOLIO_TO_OPT_RATIO=5      # burn $1 Portfolio -> 5 OPT
EXERCISE_OPT_PER_DOLLAR=5     # OPT burned per $1 of strike notional
PREMIUM_OPT_PER_DOLLAR=5      # OPT charged per $1 of option value
EXERCISE_PAYOUT_MODE=market   # market | strike

# --- Energy ---
INITIAL_ENERGY_CAPACITY=50
ENERGY_REFILL_SECONDS=300     # +1 Energy every 5 min
OPTION_ENERGY_COST=1
PVP_ENERGY_COST=10

# --- XP ---
SUCCESSFUL_OPTION_XP=100
PVP_WIN_XP=500

# --- PvP ---
PVP_INITIAL_OPT=10000
PVP_WIN_OPT_REWARD=300
PVP_WIN_PORTFOLIO_REWARD=250

# --- Store ---
ENERGY_CELL_PRICES=600,1100,1800,2800
ENERGY_CELL_STEP=10
ENERGY_CHARGE_PRICE=400
```

⚠️ **`PORTFOLIO_TO_OPT_RATIO`, `EXERCISE_OPT_PER_DOLLAR` and `PREMIUM_OPT_PER_DOLLAR` must stay
equal.** They define one exchange rate between OPT and virtual dollars. If converting Portfolio to
OPT is cheaper than converting it back through an option, buying deep in-the-money and exercising
becomes a risk-free money pump that breaks the leaderboard.

---

## How the numbers work

**Pricing.** Both card types are call-shaped, so one model prices both — intrinsic value plus time
value:

```
intrinsic  = max(0, spot − strike) × amount
timeValue  = spot × amount × vol × TIME_VALUE_AT_REFERENCE × (secondsLeft / REFERENCE_SECONDS) ^ 0.25
value$     = intrinsic + timeValue
premiumOPT = ceil(value$ × PREMIUM_OPT_PER_DOLLAR)
```

Premiums are always computed server-side from the cached price — never taken from the client. The
same function drives the live "Current Value" on every card face.

The time-value curve is anchored rather than derived. Black-Scholes grows as `√T`, which is right
for a real option and wrong here at both ends: over two minutes it prices a card at nothing, and
over a month it wants 76% of notional. `TIME_VALUE_AT_REFERENCE` is the fraction of notional an
at-the-money card costs at `REFERENCE_SECONDS` (15 minutes) for an asset with vol 1.0, and the 0.25
exponent sets how fast it grows from there — a 1h card costs ~2.3× a 2m card, and a 1-month card
lands near 10% of notional. Expiry still matters; it no longer dominates every other choice on the
card. Dependence on **amount** stays exactly linear, since that's the one relationship players
expect to be precise.

These live in `lib/config.ts` as plain constants rather than env vars because the pricing model runs
on both the server and the client, and a client bundle can't read the server env.

**Settlement.** At expiry the current spot is snapshotted into the card, so exercising later can't
be gamed by waiting.

- **Buy** — above strike → `WON` + XP, and may be exercised: burn `strike × amount ×
  EXERCISE_OPT_PER_DOLLAR` OPT, receive `settle_price × amount` Portfolio. Otherwise `LOST`.
- **Sell** — at or below strike → collateral released in full, premium kept, XP awarded. Above →
  `loss = min((settle_price − strike) × amount, collateral)`, capped so a player can never go
  negative.

### One interpretation worth flagging

`IDEA.md` §4 describes exercising as burning OPT for `strike × amount` and receiving `strike ×
amount` Portfolio — which makes exercising a flat currency swap where *how right you were* doesn't
matter. This build instead credits the **market value** of the position (`settle_price × amount`),
so profit is `(spot − strike) × amount` like a real call, which is what §31's "not simply guess
whether BTC goes up or down" asks for. Set `EXERCISE_PAYOUT_MODE=strike` to restore the literal
reading — no code changes needed.

---

## Assets

BTC, ETH, SOL, BNB, XRP, DOGE, AVAX and LINK. Prices are fetched in one batched request and cached
15s in the `price_cache` table, shared across all players, which keeps the app inside the free API
tier no matter how many clients are polling.

---

## Project layout

```
app/
  (game)/          home · cards · store · rankings · pvp · pvp/[id]
  actions/         server actions: auth, cards, store, pvp
  api/state        global poll — settles, then returns player + prices + cards
  api/pvp/[id]/    match poll — settles, then returns match + players + match cards
components/        OptionCard, CreateOptionPanel, CardGrid, MatchRoom, ResourceBar, …
lib/
  config.ts        every tunable knob
  options.ts       pricing + settlement maths
  settle.ts        expiry resolution + match finalisation
  wallet.ts        the single accessor for global vs PvP balances
  energy.ts        lazy regeneration
db/schema.sql      re-runnable schema
```

`lib/wallet.ts` is the reason the two economies can't leak into each other: global balances live on
`users`, PvP balances on `match_players`, and every read and write goes through one accessor
keyed by `matchId`. Cards use the same table with a nullable `match_id`, so one settlement engine
serves both.

---

## Known limits

It's a demo, so: no passwords, no rate limiting, no historical price charts, no random matchmaking,
desktop-first layout, and settlement uses the price at the moment the settler runs rather than a
true historical close.
