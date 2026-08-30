"use client";

import { Layers, ShoppingBag, User } from "lucide-react";
import { useState } from "react";
import CardGrid from "@/components/CardGrid";
import { useGame } from "@/components/GameProvider";

const TABS = [
  { key: "mine", label: "My Cards", icon: User },
  { key: "all", label: "All Cards", icon: Layers },
  { key: "sale", label: "For Sale", icon: ShoppingBag },
] as const;

export default function CardsPage() {
  const { state } = useGame();
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("mine");

  if (!state) return <div className="panel h-64 animate-pulse opacity-50" />;

  const me = state.me;
  const all = state.cards;
  const cards =
    tab === "mine"
      ? all.filter((c) => c.owner_id === me.id)
      : tab === "sale"
        ? all.filter((c) => c.for_sale && c.status === "ACTIVE")
        : all.filter((c) => c.status === "ACTIVE" || c.status === "WON");

  const hint = {
    mine: "Everything you own, live and resolved. Winning cards can be exercised; active ones can be listed.",
    all: "Every option alive in the game right now. Visible to everyone — but only cards the owner listed can be bought.",
    sale: "Buy Options transfer for Portfolio Value, rated against what the engine says they're worth. Sell Options transfer the obligation instead: you lock the collateral and collect the takeover premium.",
  }[tab];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            data-on={tab === t.key}
            onClick={() => setTab(t.key)}
            className="chip inline-flex items-center gap-1.5"
          >
            <t.icon size={13} />
            {t.label}
            <span className="text-[10px] opacity-60">
              {t.key === "mine"
                ? all.filter((c) => c.owner_id === me.id).length
                : t.key === "sale"
                  ? all.filter((c) => c.for_sale && c.status === "ACTIVE").length
                  : all.filter((c) => c.status === "ACTIVE" || c.status === "WON").length}
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-mute">{hint}</p>

      {/* Only the marketplace rates asks against fair value — elsewhere there's no ask to rate. */}
      <CardGrid cards={cards} showDepth={tab === "sale"} />
    </div>
  );
}
