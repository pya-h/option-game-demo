// Applies db/schema.sql to DATABASE_URL. Destructive: drops and recreates every table.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

for (const line of readFileSync(join(root, ".env"), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}

// --test targets E2E_DATABASE_URL (or "<db>_test"), so the suite never truncates the
// database the demo is running on.
const useTest = process.argv.includes("--test");
let target = process.env.DATABASE_URL;
if (useTest) {
  if (process.env.E2E_DATABASE_URL) {
    target = process.env.E2E_DATABASE_URL;
  } else {
    const u = new URL(target);
    u.pathname += "_test";
    target = u.toString();
  }
}

const sql = readFileSync(join(root, "db/schema.sql"), "utf8");
const client = new pg.Client({ connectionString: target });
await client.connect();
await client.query(sql);
await client.end();
console.log(`schema applied to ${new URL(target).pathname.slice(1)}`);
