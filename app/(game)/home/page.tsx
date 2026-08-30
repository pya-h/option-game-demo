"use client";

import { motion } from "framer-motion";
import { ArrowRight, Layers, Sparkles } from "lucide-react";
import Link from "next/link";
import CardGrid from "@/components/CardGrid";
import CreateOptionPanel from "@/components/CreateOptionPanel";
import { useGame } from "@/components/GameProvider";

export default function HomePage() {
  const { state } = useGame();
  if (!state) return <div className="panel h-64 animate-pulse opacity-50" />;

  const me = state.me;
  const mine = state.cards.filter((c) => c.owner_id === me.id);
  const active = mine.filter((c) => c.status === "ACTIVE");
  const won = mine.filter((c) => c.status === "WON");

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="order-2 space-y-5 lg:order-1">
        {won.length > 0 && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="panel panel-hi border-mint/40 p-4"
          >
            <h2 className="mb-3 flex items-center gap-2 font-semibold text-mint">
              <Sparkles size={16} /> {won.length} winning card{won.length > 1 ? "s" : ""} ready to exercise
            </h2>
            <CardGrid cards={won} />
          </motion.section>
        )}

        <section className="panel p-4">
          <div className="mb-3 flex items-center gap-2">
            <Layers size={16} className="text-buy" />
            <h2 className="font-semibold">Your open positions</h2>
            <Link href="/cards" className="ml-auto inline-flex items-center gap-1 text-xs text-mute hover:text-buy">
              all cards <ArrowRight size={12} />
            </Link>
          </div>
          {active.length ? (
            <CardGrid cards={active} />
          ) : (
            <p className="py-10 text-center text-sm text-mute">
              No open positions. Mint your first Option Card →
            </p>
          )}
        </section>
      </div>

      <div className="order-1 space-y-5 lg:order-2">
        <CreateOptionPanel
          prices={state.prices}
          optBalance={me.opt}
          spendable={me.spendable}
          energy={me.energy}
          energyCost={state.cfg.optionEnergyCost}
          premiumOptPerDollar={state.cfg.premiumOptPerDollar}
        />

        <section className="panel p-4 text-xs leading-relaxed text-mute">
          <h3 className="mb-2 text-sm font-semibold text-slate-200">The loop</h3>
          <ol className="space-y-1.5">
            <li>
              <b className="text-buy">1.</b> Spend Energy + OPT to mint a card on a live price.
            </li>
            <li>
              <b className="text-buy">2.</b> Keep it, or list it on the marketplace for Portfolio.
            </li>
            <li>
              <b className="text-buy">3.</b> On expiry a correct call pays{" "}
              <span className="text-sell">+{state.cfg.successfulOptionXp} XP</span> — even if you never exercise.
            </li>
            <li>
              <b className="text-buy">4.</b> Exercise to burn OPT and convert the win into Portfolio.
            </li>
            <li>
              <b className="text-buy">5.</b> Spend Portfolio on cards, Energy, or more OPT — then compete.
            </li>
          </ol>
        </section>
      </div>
    </div>
  );
}
