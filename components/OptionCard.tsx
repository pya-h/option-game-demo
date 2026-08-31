"use client";

import { motion } from "framer-motion";
import {
  Flame,
  Lock,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Tag,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { useState } from "react";
import { ASSET_MAP } from "@/lib/config";
import { amt, opt as fmtOpt, price, usd } from "@/lib/fmt";
import { cardValue } from "@/lib/options";
import { rarityOf } from "@/lib/rarity";
import type { CardDTO, CardEventDTO } from "@/lib/types";
import Countdown, { useNow } from "./Countdown";

const STAMPS: Record<string, { text: string; cls: string }> = {
  WON: { text: "WON", cls: "text-mint" },
  LOST: { text: "LOST", cls: "text-danger" },
  EXERCISED: { text: "EXERCISED", cls: "text-gold" },
  SETTLED: { text: "SETTLED", cls: "text-mute" },
  // Won, but never claimed in time. Still a win — the XP was paid at settlement.
  LAPSED: { text: "LAPSED", cls: "text-mute" },
};

/**
 * The card face. Built as a trading card rather than a stats panel: a framed portrait with a
 * crest, an art panel, a stat block and a rarity-tinted border — and a back, because the
 * ownership and premium history is public and the back of a card is where that belongs.
 *
 * Everything shown is derived, never stored. Rarity comes from values frozen at mint, and the
 * live value is recomputed from the same function the server prices with.
 */
export default function OptionCard({
  card,
  spot,
  meId,
  actions,
  onFlip,
  history,
  index = 0,
}: {
  card: CardDTO;
  spot: number;
  meId: number;
  actions?: React.ReactNode;
  /** Asked to load history the first time the card is turned over. */
  onFlip?: () => void;
  history?: CardEventDTO[] | null;
  index?: number;
}) {
  const now = useNow();
  const [flipped, setFlipped] = useState(false);
  const meta = ASSET_MAP[card.asset];
  const isBuy = card.kind === "BUY";
  const mine = card.owner_id === meId;
  const live = card.status === "ACTIVE";
  // A win is claimable until its window closes. The settler flips it to LAPSED on the next
  // poll, so between polls the deadline is the thing to trust, not the status.
  const claimable =
    card.status === "WON" &&
    !!card.exercise_deadline &&
    new Date(card.exercise_deadline).getTime() > now;
  // A match card carries no deadline: the whistle is its only clock.
  const unlimited = card.status === "WON" && !card.exercise_deadline;
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
  const tint = meta?.tint ?? accent;
  const rarity = rarityOf(card);
  const stamp = STAMPS[card.status];

  const turn = () => {
    if (!flipped) onFlip?.();
    setFlipped((f) => !f);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 22, rotateX: -10 }}
      animate={{ opacity: 1, y: 0, rotateX: 0 }}
      transition={{
        delay: Math.min(index * 0.035, 0.4),
        type: "spring",
        stiffness: 260,
        damping: 24,
      }}
      whileHover={{ y: -6 }}
      className="tcg-scene"
    >
      <div className={`tcg-flip ${flipped ? "is-flipped" : ""}`}>
        {/* ---------- front ---------- */}
        <article
          className={`tcg-card tcg-face tcg-front ${rarity.animated ? "tcg-animated" : ""} ${
            live && favourable ? "glow-profit" : ""
          }`}
          style={{
            ["--rarity" as string]: rarity.tint,
            ["--accent" as string]: accent,
            ["--tint" as string]: tint,
          }}
        >
          {/* crest bar */}
          <header className="tcg-crest">
            <span className="tcg-sigil">{card.asset}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-[11px] font-bold tracking-wide" style={{ color: accent }}>
                  {isBuy ? "BUY" : "SELL"}
                </span>
                {isBuy ? (
                  <TrendingUp size={11} style={{ color: accent }} />
                ) : (
                  <TrendingDown size={11} style={{ color: accent }} />
                )}
              </div>
              <div className="truncate text-[10px] text-mute">
                #{card.id} · {mine ? <span className="text-buy">you</span> : card.owner}
              </div>
            </div>
            <span className="tcg-stars" title={rarity.label}>
              {"★".repeat(rarity.stars)}
              <span className="opacity-25">{"★".repeat(5 - rarity.stars)}</span>
            </span>
          </header>

          {/* art panel */}
          <div className="tcg-art">
            <span className="tcg-art-glyph">{card.asset}</span>
            <div className="tcg-art-rays" />
            {stamp && <span className={`tcg-stamp ${stamp.cls}`}>{stamp.text}</span>}
            <div className="tcg-art-foot">
              <span className="text-[9px] uppercase tracking-[0.18em] text-mute">
                {live ? "spot" : "settled"}
              </span>
              <span className="tabnum font-mono text-sm font-semibold text-white">
                {price(refPrice)}
              </span>
            </div>
          </div>

          {/* stat block */}
          <div className="tcg-stats">
            <Row label="Strike" value={price(card.strike)} />
            <Row label="Amount" value={`${amt(card.amount)} ${card.asset}`} />
            {/* One row carries whichever clock matters: the expiry while the card is live, and
                then the claim window while the win is claimable. Deliberately not a fourth row
                — the frame is sized from its content and a Sell card is already the tallest
                thing in the grid. */}
            <Row
              label={live ? "Expires" : claimable ? "Claim within" : "Settled at"}
              value={
                live ? (
                  <Countdown to={card.expires_at} />
                ) : claimable ? (
                  <span className="text-gold">
                    <Countdown to={card.exercise_deadline!} />
                  </span>
                ) : (
                  price(card.settle_price ?? 0)
                )
              }
            />
            <div className="tcg-rule" />
            <Row
              label={isBuy ? "Premium paid" : "Premium earned"}
              value={
                <span className={isBuy ? "text-danger" : "text-mint"}>{fmtOpt(card.premium)}</span>
              }
            />
            {!isBuy && (
              <Row
                label="Collateral"
                value={
                  <span className="inline-flex items-center gap-1 text-gold">
                    <Lock size={10} /> {usd(card.collateral, 0)}
                  </span>
                }
              />
            )}
            <Row
              label={live ? "Current value" : "Final value"}
              value={<span className="text-[15px] font-bold text-white">{usd(v.total)}</span>}
            />
          </div>

          {/* status band */}
          <div
            className="tcg-band"
            style={{ color: favourable ? "#34d399" : live ? "#fb7185" : "#8b94ba" }}
          >
            <span className="inline-flex min-w-0 items-center gap-1.5">
              {live &&
                (favourable ? (
                  isBuy ? (
                    <Flame size={11} />
                  ) : (
                    <ShieldCheck size={11} />
                  )
                ) : isBuy ? null : (
                  <ShieldAlert size={11} />
                ))}
              <span className="truncate">
                {live
                  ? favourable
                    ? isBuy
                      ? "Currently profitable"
                      : "Obligation safe"
                    : isBuy
                      ? "Out of the money"
                      : "Obligation at risk"
                  : card.status === "WON"
                    ? claimable || unlimited
                      ? "Ready to claim"
                      : "Window closed"
                    : card.status === "LAPSED"
                      ? "Never claimed"
                      : card.status === "EXERCISED"
                      ? "Converted to Portfolio"
                      : card.status === "LOST"
                        ? "Expired worthless"
                        : "Resolved"}
              </span>
            </span>
            {card.for_sale && (
              <span className="tcg-tag">
                <Tag size={9} />
                {isBuy ? usd(card.ask ?? 0, 0) : `${fmtOpt(card.ask ?? 0)}`}
              </span>
            )}
          </div>

          <footer className="tcg-actions">
            {actions}
            <button onClick={turn} title="Ownership & premium history" className="tcg-turn">
              <RotateCcw size={14} />
            </button>
          </footer>
        </article>

        {/* ---------- back ---------- */}
        <article
          className={`tcg-card tcg-face tcg-back ${rarity.animated ? "tcg-animated" : ""}`}
          style={{
            ["--rarity" as string]: rarity.tint,
            ["--accent" as string]: accent,
            ["--tint" as string]: tint,
          }}
        >
          <header className="tcg-crest">
            <span className="tcg-sigil">{card.asset}</span>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold tracking-wide text-slate-200">PROVENANCE</div>
              <div className="truncate text-[10px] text-mute">card #{card.id}</div>
            </div>
            <span className="tcg-stars">{rarity.label}</span>
          </header>

          <div className="tcg-log">
            <p className="mb-2 text-[10px] leading-relaxed text-mute">
              Every premium and every transfer is public — the compensation for this card is on
              the record.
            </p>
            {history === undefined || history === null ? (
              <div className="space-y-1.5">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-9 animate-pulse rounded-lg bg-white/5" />
                ))}
              </div>
            ) : history.length ? (
              <ol className="space-y-1.5">
                {history.map((e) => (
                  <li key={e.id} className="tcg-log-row">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[10px] font-bold" style={{ color: accent }}>
                        {e.type}
                      </span>
                      <span className="ml-auto text-[9px] text-mute">
                        {new Date(e.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    {(e.from_user || e.to_user) && (
                      <div className="text-[10px] text-mute">
                        {e.from_user ?? "—"} →{" "}
                        <span className="text-slate-200">{e.to_user ?? "—"}</span>
                      </div>
                    )}
                    {e.note && <div className="text-[10px] text-slate-300">{e.note}</div>}
                  </li>
                ))}
              </ol>
            ) : (
              <p className="py-6 text-center text-[11px] text-mute">No events yet.</p>
            )}
          </div>

          <footer className="tcg-actions">
            <button onClick={turn} className="tcg-turn ml-auto" title="Back to the card">
              <RotateCcw size={14} />
            </button>
          </footer>
        </article>
      </div>
    </motion.div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-[10px] uppercase tracking-[0.1em] text-mute">{label}</span>
      <span className="tabnum font-mono text-[12px] text-slate-200">{value}</span>
    </div>
  );
}
