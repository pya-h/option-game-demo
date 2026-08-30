-- OPT game demo schema. Re-runnable: drops everything and recreates.

DROP TABLE IF EXISTS matchmaking_queue CASCADE;
DROP TABLE IF EXISTS card_events CASCADE;
DROP TABLE IF EXISTS cards CASCADE;
DROP TABLE IF EXISTS match_players CASCADE;
DROP TABLE IF EXISTS matches CASCADE;
DROP TABLE IF EXISTS price_cache CASCADE;
DROP TABLE IF EXISTS users CASCADE;

CREATE TABLE users (
  id                SERIAL PRIMARY KEY,
  username          TEXT NOT NULL,
  opt               NUMERIC(20,6) NOT NULL DEFAULT 0,
  portfolio         NUMERIC(20,6) NOT NULL DEFAULT 0,
  locked            NUMERIC(20,6) NOT NULL DEFAULT 0,
  xp                INTEGER NOT NULL DEFAULT 0,
  energy            NUMERIC(10,4) NOT NULL DEFAULT 0,
  energy_capacity   INTEGER NOT NULL DEFAULT 50,
  energy_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_locked_within_portfolio CHECK (locked <= portfolio),
  CONSTRAINT users_no_negative CHECK (opt >= 0 AND portfolio >= 0 AND locked >= 0)
);

-- Sign-in looks accounts up case-insensitively, so uniqueness has to match. A plain UNIQUE on
-- username would let two concurrent signups for "Bob" and "bob" both land, after which the
-- lookup picks between them arbitrarily.
CREATE UNIQUE INDEX users_username_lower_idx ON users (lower(username));

CREATE TABLE matches (
  id           SERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  creator_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('DUEL','GROUP')),
  status       TEXT NOT NULL DEFAULT 'LOBBY' CHECK (status IN ('LOBBY','ACTIVE','FINISHED')),
  duration_min INTEGER NOT NULL,
  started_at   TIMESTAMPTZ,
  ends_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE match_players (
  match_id      INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state         TEXT NOT NULL DEFAULT 'INVITED' CHECK (state IN ('INVITED','JOINED','DECLINED')),
  pvp_opt       NUMERIC(20,6) NOT NULL DEFAULT 0,
  pvp_portfolio NUMERIC(20,6) NOT NULL DEFAULT 0,
  pvp_locked    NUMERIC(20,6) NOT NULL DEFAULT 0,
  final_rank    INTEGER,
  joined_at     TIMESTAMPTZ,
  PRIMARY KEY (match_id, user_id),
  -- Same invariants the global balances carry. PvP has no Energy limit, so it sees the
  -- most concurrent writes and is the place a locking bug would surface first.
  CONSTRAINT mp_locked_within_portfolio CHECK (pvp_locked <= pvp_portfolio),
  CONSTRAINT mp_no_negative CHECK (pvp_opt >= 0 AND pvp_portfolio >= 0 AND pvp_locked >= 0)
);

-- Players waiting for a random match. One row per player — the primary key is what makes
-- double-queueing impossible — and a bucket is every row sharing (mode, size, duration_min).
-- seen_at is refreshed by the polling client, so someone who closes the tab ages out of the
-- queue instead of holding a seat nobody can fill.
CREATE TABLE matchmaking_queue (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL CHECK (mode IN ('DUEL','GROUP')),
  size         INTEGER NOT NULL CHECK (size BETWEEN 2 AND 8),
  duration_min INTEGER NOT NULL,
  queued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  seen_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX matchmaking_bucket_idx
  ON matchmaking_queue (mode, size, duration_min, queued_at);

-- match_id NULL => global game card. Otherwise the card belongs only to that PvP match.
CREATE TABLE cards (
  id             SERIAL PRIMARY KEY,
  match_id       INTEGER REFERENCES matches(id) ON DELETE CASCADE,
  owner_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('BUY','SELL')),
  asset          TEXT NOT NULL,
  strike         NUMERIC(20,6) NOT NULL,
  amount         NUMERIC(20,8) NOT NULL,
  spot_at_create NUMERIC(20,6) NOT NULL,
  premium        NUMERIC(20,6) NOT NULL,
  collateral     NUMERIC(20,6) NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at     TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (status IN ('ACTIVE','WON','LOST','EXERCISED','SETTLED')),
  settle_price   NUMERIC(20,6),
  settled_at     TIMESTAMPTZ,
  for_sale       BOOLEAN NOT NULL DEFAULT FALSE,
  -- BUY: asking price in Portfolio $. SELL: takeover premium in OPT paid to the assumer.
  ask            NUMERIC(20,6)
);

CREATE INDEX cards_match_status_idx ON cards (match_id, status);
CREATE INDEX cards_owner_idx        ON cards (owner_id);
CREATE INDEX cards_for_sale_idx     ON cards (for_sale) WHERE for_sale;
CREATE INDEX cards_due_idx          ON cards (expires_at) WHERE status = 'ACTIVE';

CREATE TABLE card_events (
  id               SERIAL PRIMARY KEY,
  card_id          INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  type             TEXT NOT NULL,
  actor_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  from_user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  to_user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  opt_delta        NUMERIC(20,6) NOT NULL DEFAULT 0,
  portfolio_delta  NUMERIC(20,6) NOT NULL DEFAULT 0,
  note             TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX card_events_card_idx ON card_events (card_id, id);

CREATE TABLE price_cache (
  asset      TEXT PRIMARY KEY,
  price      NUMERIC(20,6) NOT NULL,
  prev_price NUMERIC(20,6) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
