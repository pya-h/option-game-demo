"use client";

import { motion } from "framer-motion";
import { BookOpen, Home, Layers, LogOut, Store, Swords, Trophy } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/app/actions/auth";
import { useGame } from "./GameProvider";

const items = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/cards", label: "Cards", icon: Layers },
  { href: "/store", label: "Store", icon: Store },
  { href: "/rankings", label: "Rankings", icon: Trophy },
  { href: "/pvp", label: "PvP", icon: Swords },
  { href: "/guide", label: "Guide", icon: BookOpen },
];

export default function Nav() {
  const path = usePathname();
  const { state } = useGame();

  return (
    <header className="sticky top-0 z-30 -mx-4 flex items-center gap-2 border-b border-edge/60 bg-void/80 px-4 py-3 backdrop-blur-xl">
      <Link href="/home" className="mr-2 flex items-center gap-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-buy to-indigo-500 text-sm shadow-md shadow-cyan-500/30">
          🎴
        </span>
        <span className="font-mono text-lg font-bold tracking-tight">OPT</span>
      </Link>

      <nav className="flex flex-1 items-center gap-1 overflow-x-auto">
        {items.map((it) => {
          const on = path === it.href || path.startsWith(it.href + "/");
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`relative flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition ${
                on ? "text-white" : "text-mute hover:text-slate-200"
              }`}
            >
              {on && (
                <motion.span
                  layoutId="nav-pill"
                  className="absolute inset-0 -z-10 rounded-lg border border-buy/40 bg-buy/10"
                  transition={{ type: "spring", stiffness: 380, damping: 30 }}
                />
              )}
              <it.icon size={15} />
              {it.label}
              {it.href === "/pvp" && !!state?.pendingInvites && (
                <span className="ml-1 grid h-4 min-w-4 place-items-center rounded-full bg-sell px-1 text-[10px] font-bold text-black">
                  {state.pendingInvites}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <span className="hidden font-mono text-sm text-slate-300 sm:block">
        {state?.me.username ?? "…"}
      </span>
      <form action={logout}>
        <button className="rounded-lg p-2 text-mute transition hover:bg-white/5 hover:text-danger" title="Sign out">
          <LogOut size={16} />
        </button>
      </form>
    </header>
  );
}
