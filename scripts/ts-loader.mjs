/**
 * Minimal module hook so a plain Node script can import the app's TypeScript modules.
 *
 * Node strips the types itself; all this adds is the two resolution rules the app relies on
 * and Node doesn't know about: the "@/" path alias from tsconfig, and extensionless relative
 * imports between .ts files.
 */
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function resolve(specifier, context, next) {
  if (specifier.startsWith("@/")) {
    const base = join(root, specifier.slice(2));
    for (const c of [base, base + ".ts", join(base, "index.ts")]) {
      if (existsSync(c)) return next(pathToFileURL(c).href, context);
    }
  }

  if (specifier.startsWith(".") && context.parentURL?.endsWith(".ts")) {
    const base = join(dirname(fileURLToPath(context.parentURL)), specifier);
    for (const c of [base + ".ts", join(base, "index.ts")]) {
      if (existsSync(c)) return next(pathToFileURL(c).href, context);
    }
  }

  return next(specifier, context);
}
