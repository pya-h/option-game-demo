"use server";

import { redirect } from "next/navigation";
import { CFG } from "@/lib/config";
import { q } from "@/lib/db";
import { clearSession, setSession } from "@/lib/session";

export async function login(formData: FormData) {
  const raw = String(formData.get("username") ?? "").trim();
  const username = raw.replace(/\s+/g, "_").slice(0, 20);
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return { ok: false, message: "3-20 letters, digits or underscores" };
  }

  // Create-or-resume in one statement. Doing it as SELECT-then-INSERT loses a race: two
  // sign-ins for the same name both miss, both insert, and the loser hits the case-insensitive
  // unique index and gets a 500 instead of simply resuming the account that just won.
  const [row] = await q<{ id: number }>(
    // energy is numeric and energy_capacity is integer, so the shared parameter needs
    // explicit casts — Postgres can't deduce one type for both.
    `WITH inserted AS (
       INSERT INTO users (username, opt, portfolio, energy, energy_capacity, energy_updated_at)
       VALUES ($1, $2, 0, $3::numeric, $3::integer, now())
       ON CONFLICT (lower(username)) DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id FROM users WHERE lower(username) = lower($1)
     LIMIT 1`,
    [username, CFG.INITIAL_OPT_BALANCE, CFG.INITIAL_ENERGY_CAPACITY]
  );
  if (!row) return { ok: false, message: "Could not sign you in — try again" };

  await setSession(row.id);
  redirect("/home");
}

export async function logout() {
  await clearSession();
  redirect("/");
}
