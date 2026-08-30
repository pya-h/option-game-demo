"use client";

import { motion } from "framer-motion";
import { Flame, History, Lock, Tag, TrendingDown, TrendingUp } from "lucide-react";
import { ASSET_MAP } from "@/lib/config";
import { amt, opt as fmtOpt, price, usd } from "@/lib/fmt";
import { cardValue } from "@/lib/options";
import type { CardDTO } from "@/lib/types";
import Countdown, { useNow } from "./Countdown";

const STAMPS: Record<string, { text: string; cls: string }> = {
  WON: { text: "WON", cls: "text-mint" },
  LOST: { text: "LOST", cls: "text-danger" },
  EXERCISED: { text: "EXERCISED", cls: "text-gold" },
  SETTLED: { text: "SETTLED", cls: "text-mute" },
};

export default function OptionCard({
  card,
  spot,
  meId,
  actions,
  onHistory,
  index = 0,
}: {
  card: CardDTO;
  spot: number;
  meId: number;
  actions?: React.ReactNode;
  onHistory?: () => void;
  index?: number;
}) {
  const now = useNow();
  const meta = ASSET_MAP[card.asset];
  const isBuy = card.kind === "BUY";
  const mine = card.owner_id === meId;
  const live = card.status === "ACTIVE";
  const secondsLeft = Math.max(0, (new Date(card.expires_at).getTime() - now) / 1000);

  const refPrice = live ? spot : (card.settle_price ?? spot);
  const v = cardValue({
    asset: card.asset,
    strike: card.strike,
    amount: card.amount,
    spot: refPrice,
    secondsLeft: live ? secondsLeft : 0,
  });

  // A Buy card wins when it's in the money; a Sell writer wants the opposite.
  const favourable = isBuy ? v.inTheMoney : !v.inTheMoney;
  const accent = isBuy ? "#22d3ee" : "#f472b6";
  const stamp = STAMPS[card.status];

  return (
    <motion.article
      initial={{ opacity: 0, y: 18, rotateX: -8 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{ delay: Math.min(index * 0.035, 0.4), type: "spring", stiffness: 260, damping: 24 }}
      whileHover={{ y: -5 }}
      className={`foil panel relative flex flex-col overflow-hidden p-0 ${
        live && favourable ? "glow-profit" : ""
      }`}
      style={{ borderColor: `${accent}44` }}
    >
      {/* header */}
      <div
        className="flex items-center gap-2.5 border-b px-4 py-3"
        style={{
          borderColor: `${accent}33`,
          background: `linear-gradient(100deg, ${meta?.tint}22, ${accent}12 60%, transparent)`,
        }}
      >
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl font-mono text-[11px] font-bold"
          style={{ background: `${meta?.tint}26`, color: meta?.tint, boxShadow: `0 0 18px -6px ${meta?.tint}` }}
        >
          {card.asset}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 font-semibold leading-tight">
            <span style={{ color: accent }}>{isBuy ? "BUY" : "SELL"}</span>
            <span className="text-slate-300">OPTION</span>
            {isBuy ? (
              <TrendingUp size={13} style={{ color: accent }} />
            ) : (
              <TrendingDown size={13} style={{ color: accent }} />
            )}
          </div>
          <div className="text-[11px] text-mute">
            #{card.id} · {mine ? <span className="text-buy">you</span> : card.owner}
          </div>
        </div>
        {stamp && <span className={`stamp text-[10px] ${stamp.cls}`}>{stamp.text}</span>}
      </div>

      {/* body */}
      <div className="space-y-1.5 px-4 py-3 text-sm">
        <Row label="Strike" value={price(card.strike)} />
        <Row label="Amount" value={`${amt(card.amount)} ${card.asset}`} />
        <Row
          label={live ? "Expires" : "Settled at"}
          value={live ? <Countdown to={card.expires_at} /> : price(card.settle_price ?? 0)}
        />
        <div className="!my-2.5 border-t border-edge/70" />
        <Row
          label={isBuy ? "Premium paid" : "Premium earned"}
          value={<span className={isBuy ? "text-danger" : "text-mint"}>{fmtOpt(card.premium)}</span>}
        />
        {!isBuy && (
          <Row
            label="Collateral"
            value={
              <span className="inline-flex items-center gap-1 text-gold">
                <Lock size={11} /> {usd(card.collateral, 0)}
              </span>
            }
          />
        )}
        <Row
          label={live ? "Current value" : "Final value"}
          value={<span className="font-semibold text-white">{usd(v.total)}</span>}
        />
      </div>

      {/* status strip */}
      <div
        className="flex items-center justify-between px-4 pb-2 text-[11px]"
        style={{ color: favourable ? "#34d399" : "#8b94ba" }}
      >
        <span className="inline-flex items-center gap-1.5">
          {live && favourable && <Flame size={12} />}
          {live
            ? favourable
              ? isBuy
                ? "Currently profitable"
                : "Obligation safe"
              : isBuy
                ? "Out of the money"
                : "Obligation at risk"
            : card.status === "WON"
              ? "Ready to exercise"
              : card.status === "EXERCISED"
                ? "Converted to Portfolio"
                : card.status === "LOST"
                  ? "Expired worthless"
                  : "Resolved"}
        </span>
        {card.for_sale && (
          <span className="inline-flex items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-gold">
            <Tag size={10} />
            {isBuy ? usd(card.ask ?? 0, 0) : `${fmtOpt(card.ask ?? 0)} to assume`}
          </span>
        )}
      </div>

      {(actions || onHistory) && (
        <div className="mt-auto flex items-center gap-2 border-t border-edge/70 px-3 py-2.5">
          {actions}
          {onHistory && (
            <button
              onClick={onHistory}
              title="Ownership & premium history"
              className="ml-auto rounded-lg p-2 text-mute transition hover:bg-white/5 hover:text-slate-200"
            >
              <History size={15} />
            </button>
          )}
        </div>
      )}
    </motion.article>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[12px] text-mute">{label}</span>
      <span className="tabnum font-mono text-[13px] text-slate-200">{value}</span>
    </div>
  );
}
