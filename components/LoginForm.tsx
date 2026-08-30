"use client";

import { motion } from "framer-motion";
import { Sparkles, Swords, TrendingUp, Zap } from "lucide-react";
import { useState, useTransition } from "react";
import { login } from "@/app/actions/auth";

const bullets = [
  { icon: TrendingUp, text: "Mint option cards on live crypto prices" },
  { icon: Sparkles, text: "Trade them with other players for Portfolio" },
  { icon: Zap, text: "Spend Energy, write collateralised Sell Options" },
  { icon: Swords, text: "Drop into isolated PvP arenas and win rewards" },
];

export default function LoginForm() {
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="panel panel-hi w-full max-w-md p-8"
      >
        <div className="mb-1 flex items-center gap-3">
          <motion.div
            animate={{ rotate: [0, 8, -8, 0] }}
            transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
            className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-buy to-indigo-500 text-2xl shadow-lg shadow-cyan-500/30"
          >
            🎴
          </motion.div>
          <div>
            <h1 className="font-mono text-3xl font-bold tracking-tight">OPT</h1>
            <p className="text-xs tracking-[0.28em] text-mute">OPTIONS TRADING ARENA</p>
          </div>
        </div>

        <ul className="my-6 space-y-2.5">
          {bullets.map((b, i) => (
            <motion.li
              key={b.text}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.08 }}
              className="flex items-center gap-3 text-sm text-slate-300"
            >
              <b.icon size={16} className="shrink-0 text-buy" />
              {b.text}
            </motion.li>
          ))}
        </ul>

        <form
          action={(fd) =>
            start(async () => {
              const r = await login(fd);
              if (r && !r.ok) setErr(r.message);
            })
          }
          className="space-y-3"
        >
          <input
            name="username"
            autoFocus
            autoComplete="off"
            placeholder="pick a username"
            className="w-full rounded-xl border border-edge bg-black/40 px-4 py-3 font-mono outline-none transition focus:border-buy focus:shadow-[0_0_24px_-6px_rgba(34,211,238,0.8)]"
          />
          <button disabled={pending} className="btn btn-primary w-full">
            {pending ? "Entering…" : "Enter the Arena"}
          </button>
          {err && <p className="text-center text-sm text-danger">{err}</p>}
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-mute">
          No password — type any name to create or resume an account.
          <br />
          Everything here is virtual. No real money, no crypto ownership.
        </p>
      </motion.div>
    </main>
  );
}
