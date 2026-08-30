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

  const [existing] = await q<{ id: number }>(`SELECT id FROM users WHERE lower(username) = lower($1)`, [
    username,
  ]);

  let id = existing?.id;
  if (!id) {
    const [created] = await q<{ id: number }>(
      // energy is numeric and energy_capacity is integer, so the shared parameter needs
      // explicit casts — Postgres can't deduce one type for both.
      `INSERT INTO users (username, opt, portfolio, energy, energy_capacity, energy_updated_at)
       VALUES ($1, $2, 0, $3::numeric, $3::integer, now()) RETURNING id`,
      [username, CFG.INITIAL_OPT_BALANCE, CFG.INITIAL_ENERGY_CAPACITY]
    );
    id = created.id;
  }

  await setSession(id);
  redirect("/home");
}

export async function logout() {
  await clearSession();
  redirect("/");
}
