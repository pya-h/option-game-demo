"use client";

import { motion } from "framer-motion";
import { Battery, BatteryCharging, Droplets, Recycle, Zap } from "lucide-react";
import { useState } from "react";
import {
  buyCapacityChip,
  buyDripUpgrade,
  buyEnergyCell,
  buyEnergyCharge,
  convertPortfolioToOpt,
} from "@/app/actions/store";
import { useGame } from "@/components/GameProvider";
import { num, usd } from "@/lib/fmt";

export default function StorePage() {
  const { state, run, busy } = useGame();
  const [burn, setBurn] = useState(100);

  if (!state) return <div className="panel h-64 animate-pulse opacity-50" />;
  const me = state.me;
  const cfg = state.cfg;

  // Counted from what has been bought, not inferred from total capacity. Levels raise the
  // ceiling too, and the old arithmetic read those bonuses as purchases — a high-level player
  // who owned nothing was charged for a tier they never bought.
  const tier = Math.max(0, me.energyUpgrades);
  const maxed = tier >= cfg.energyCellPrices.length;
  // Guarded rather than indexed blind: at max tier there is no next price, and `spendable <
  // undefined` is quietly false, which would leave the button enabled on a purchase that
  // cannot happen.
  const cellPrice = maxed ? null : cfg.energyCellPrices[tier];
  const chipPrice = maxed ? null : cfg.energyCapacityPrices[tier];
  const full = me.energy >= me.energy_capacity;
  const nextCap = me.energy_capacity + cfg.energyCellStep;
  // What the bundle saves against buying the two pieces separately.
  const saving = cellPrice !== null && chipPrice !== null
    ? chipPrice + cfg.energyChargePrice - cellPrice
    : 0;
  const dripTier = Math.max(0, me.dripUpgrades);
  const dripMaxed = dripTier >= cfg.optDripUpgradePrices.length;
  const dripPrice = dripMaxed ? null : cfg.optDripUpgradePrices[dripTier];

  return (
    <div className="space-y-4">
      <header className="panel panel-hi flex flex-wrap items-center gap-4 px-5 py-4">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-2xl shadow-lg">
          🏪
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold">Supply Store</h1>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-mute">
            Everything on these shelves is bought with Portfolio Value — the same number that
            ranks you. Spending makes you stronger now and costs you leaderboard position.
          </p>
        </div>
        <div className="ml-auto rounded-xl border border-edge bg-black/30 px-3.5 py-2 text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-mute">to spend</div>
          <div className="tabnum font-mono text-lg font-semibold text-mint">
            {usd(me.spendable, 0)}
          </div>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
        {/* Energy Cell — capacity + refill, the bundle */}
        <Item
          icon={Zap}
          tone="#fbbf24"
          title="Energy Cell"
          subtitle="Capacity +, and charged to full"
          badge={saving > 0 ? `save ${usd(saving, 0)}` : undefined}
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">
              {Math.floor(me.energy)} / {me.energy_capacity}
            </span>
            <span className="text-gold">→</span>
            <span className="text-gold">
              {nextCap} / {nextCap}
            </span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {maxed
              ? "You've installed every cell available."
              : `Tier ${tier + 1} of ${cfg.energyCellPrices.length} · both upgrades in one`}
          </p>
          <button
            className="btn btn-gold w-full"
            disabled={busy || cellPrice === null || me.spendable < cellPrice}
            onClick={() => run(() => buyEnergyCell())}
          >
            {cellPrice === null ? "Max capacity" : `Install · ${usd(cellPrice, 0)}`}
          </button>
        </Item>

        {/* Capacity Chip — the ceiling only */}
        <Item
          icon={Battery}
          tone="#a855f7"
          title="Capacity Chip"
          subtitle="Raises the ceiling only"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">{me.energy_capacity}</span>
            <span className="text-sell">→</span>
            <span className="text-sell">{nextCap}</span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {maxed
              ? "Capacity is already at its maximum."
              : "The new slots fill at the usual rate — no top-up."}
          </p>
          <button
            className="btn btn-sell w-full"
            disabled={busy || chipPrice === null || me.spendable < chipPrice}
            onClick={() => run(() => buyCapacityChip())}
          >
            {chipPrice === null ? "Max capacity" : `Fit · ${usd(chipPrice, 0)}`}
          </button>
        </Item>

        {/* Energy Charge — the bar only */}
        <Item
          icon={BatteryCharging}
          tone="#22d3ee"
          title="Energy Charge"
          subtitle="Instant refill to full"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">
              {Math.floor(me.energy)} / {me.energy_capacity}
            </span>
            <span className="text-buy">→</span>
            <span className="text-buy">
              {me.energy_capacity} / {me.energy_capacity}
            </span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            Energy regenerates +1 every {Math.round(cfg.energyRefillSeconds / 60)} min on its own.
          </p>
          <button
            className="btn btn-primary w-full"
            disabled={busy || full || me.spendable < cfg.energyChargePrice}
            onClick={() => run(() => buyEnergyCharge())}
          >
            {full ? "Already full" : `Refill · ${usd(cfg.energyChargePrice, 0)}`}
          </button>
        </Item>

        {/* OPT drip upgrade — one-time, so it can't compound into an income */}
        <Item
          icon={Droplets}
          tone="#38bdf8"
          title="Bigger Drops"
          subtitle="Permanently raises the OPT drop"
        >
          <div className="mb-3 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-mute">+{num(me.optPerDrip, 0)}</span>
            <span className="text-buy">→</span>
            <span className="text-buy">+{num(me.optPerDrip + cfg.optDripUpgradeStep, 0)}</span>
          </div>
          <p className="mb-3 text-center text-[11px] text-mute">
            {dripMaxed
              ? "Every drop upgrade is yours."
              : `One-time · ${dripTier + 1} of ${cfg.optDripUpgradePrices.length}`}
          </p>
          <button
            className="btn btn-primary w-full"
            disabled={busy || dripPrice === null || me.spendable < dripPrice}
            onClick={() => run(() => buyDripUpgrade())}
          >
            {dripPrice === null ? "Fully upgraded" : `Upgrade · ${usd(dripPrice, 0)}`}
          </button>
        </Item>

        {/* Portfolio -> OPT */}
        <Item
          icon={Recycle}
          tone="#34d399"
          title="Portfolio → OPT"
          subtitle={`Burn $1 for ${cfg.portfolioToOptRatio} OPT`}
        >
          <div className="mb-2 flex items-center justify-center gap-3 font-mono text-lg">
            <span className="text-danger">−{usd(burn, 0)}</span>
            <span className="text-mint">→</span>
            <span className="text-mint">+{num(burn * cfg.portfolioToOptRatio, 0)} OPT</span>
          </div>
          <input
            type="range"
            min={10}
            max={Math.max(10, Math.floor(me.spendable) || 10)}
            step={10}
            value={Math.min(burn, Math.max(10, Math.floor(me.spendable) || 10))}
            onChange={(e) => setBurn(Number(e.target.value))}
            className="mb-3 w-full"
            style={{
              ["--pct" as any]: `${(burn / Math.max(10, Math.floor(me.spendable) || 10)) * 100}%`,
            }}
          />
          <p className="mb-3 text-center text-[11px] text-mute">
            {usd(me.spendable, 0)} free to burn. Locked collateral can&apos;t be converted.
          </p>
          <button
            className="btn btn-primary w-full"
            disabled={busy || me.spendable < burn || burn <= 0}
            onClick={() => run(() => convertPortfolioToOpt(burn))}
          >
            Burn for OPT
          </button>
        </Item>
      </div>
    </div>
  );
}

/**
 * One item on the shelf.
 *
 * Built like the card art panel — layered gradients, one glyph, no image assets — so the shop
 * matches the cards rather than looking like a settings screen that wandered in. `tone` is a
 * single hue per item, which is what makes a row of four read as four distinct objects.
 */
/**
 * One item on the shelf.
 *
 * Built like the card art panel — layered gradients, one glyph, no image assets — so the shop
 * matches the cards rather than looking like a settings screen that wandered in. `tone` is a
 * single hue per item, which is what makes a row of items read as distinct objects.
 */
function Item({
  icon: Icon,
  tone,
  title,
  subtitle,
  badge,
  children,
}: {
  icon: any;
  tone: string;
  title: string;
  subtitle: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -5 }}
      transition={{ type: "spring", stiffness: 240, damping: 22 }}
      className="shelf flex flex-col"
      style={{ ["--item" as string]: tone }}
    >
      <div className="shelf-art">
        <span className="shelf-glyph">
          <Icon size={26} />
        </span>
        {badge && <span className="shelf-tag">{badge}</span>}
      </div>

      <div className="flex flex-1 flex-col p-4">
        <h2 className="font-semibold leading-tight">{title}</h2>
        <p className="mb-3 text-[11px] text-mute">{subtitle}</p>
        <div className="mt-auto">{children}</div>
      </div>
    </motion.section>
  );
}
