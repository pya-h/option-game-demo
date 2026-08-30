// Loads .env the same way scripts/push.mjs does. Next injects it automatically at runtime;
// vitest does not, and the integration specs need DATABASE_URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

try {
  const raw = readFileSync(resolve(__dirname, "..", ".env"), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // No .env — the unit specs don't need one, and the integration specs will skip.
}
