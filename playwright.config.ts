import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

/**
 * Runs the real production build against a throwaway database, with prices pinned and the
 * test hooks mounted.
 *
 * The database is never DATABASE_URL: the suite truncates every table between specs, so it
 * resolves E2E_DATABASE_URL, or falls back to "<your database>_test", which you create once
 * with `pnpm db:push:test`. There is deliberately no path by which this points at the
 * database the demo runs on.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

function testDatabaseUrl() {
  if (process.env.E2E_DATABASE_URL) return process.env.E2E_DATABASE_URL;
  let main = process.env.DATABASE_URL;
  if (!main) {
    try {
      const raw = readFileSync(resolve(__dirname, ".env"), "utf8");
      main = raw.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/m)?.[1];
    } catch {
      /* no .env */
    }
  }
  if (!main) throw new Error("set E2E_DATABASE_URL or DATABASE_URL before running the e2e suite");
  const u = new URL(main);
  u.pathname += "_test";
  return u.toString();
}

const DB = testDatabaseUrl();

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // The suite shares one database and truncates between specs, so specs run one at a time.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    // Defaults to Playwright's bundled Chromium (`npx playwright install chromium`).
    // Set PW_CHANNEL=chrome to drive a locally installed Chrome instead.
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      DATABASE_URL: DB,
      E2E_HOOKS: "1",
      PRICE_SOURCE: "fixed",
      NODE_ENV: "production",
    },
  },
});
