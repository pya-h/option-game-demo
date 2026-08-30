"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Sparkles, Tag, TagIcon, X } from "lucide-react";
import { useState } from "react";
import { acquireCard, cardHistory, exerciseCard, listCard, unlistCard } from "@/app/actions/cards";
import { opt as fmtOpt, usd } from "@/lib/fmt";
import type { CardDTO, CardEventDTO, PriceDTO } from "@/lib/types";
import { useGame } from "./GameProvider";
import OptionCard from "./OptionCard";

export default function CardGrid({
  cards,
  prices,
  meId,
  spendable,
  optBalance,
  readOnly = false,
}: {
  cards: CardDTO[];
  prices?: PriceDTO[];
  meId?: number;
  spendable?: number;
  optBalance?: number;
  readOnly?: boolean;
}) {
  const { state, run, busy } = useGame();
  const [listing, setListing] = useState<CardDTO | null>(null);
  const [history, setHistory] = useState<{ card: CardDTO; events: CardEventDTO[] } | null>(null);

  const px = prices ?? state?.prices ?? [];
  const uid = meId ?? state?.me.id ?? 0;
  const free = spendable ?? state?.me.spendable ?? 0;
  const optBal = optBalance ?? state?.me.opt ?? 0;
  const mode = state?.cfg.exercisePayoutMode ?? "market";

  const openHistory = async (card: CardDTO) => {
    const events = await cardHistory(card.id);
    setHistory({ card, events });
  };

  if (!cards.length) return <p className="py-8 text-center text-sm text-mute">Nothing here yet.</p>;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((card, i) => {
          const spot = px.find((p) => p.asset === card.asset)?.price ?? 0;
          const mine = card.owner_id === uid;
          const live = card.status === "ACTIVE";
          let actions: React.ReactNode = null;

          if (!readOnly && mine && live) {
            actions = card.for_sale ? (
              <button className="btn btn-ghost flex-1 py-1.5 text-xs" disabled={busy}
                onClick={() => run(() => unlistCard(card.id))}>
                Cancel listing
              </button>
            ) : (
              <button className="btn btn-ghost flex-1 py-1.5 text-xs" onClick={() => setListing(card)}>
                <Tag size={12} className="mr-1 inline" />
                {card.kind === "BUY" ? "Sell card" : "Offload obligation"}
              </button>
            );
          } else if (!readOnly && mine && card.status === "WON") {
            // Mirrors lib/options exerciseCost/exercisePayout, but with the rates the
            // server actually runs on rather than the client-side defaults.
            const cost = card.strike * card.amount * (state?.cfg.exerciseOptPerDollar ?? 1);
            const payout =
              mode === "strike" ? card.strike * card.amount : (card.settle_price ?? 0) * card.amount;
            actions = (
              <button
                className="btn btn-gold flex-1 py-1.5 text-xs"
                disabled={busy || optBal < cost}
                title={optBal < cost ? `Need ${Math.ceil(cost)} OPT` : undefined}
                onClick={() => run(() => exerciseCard(card.id))}
              >
                <Sparkles size={12} className="mr-1 inline" />
                Exercise · −{Math.ceil(cost)} OPT → +{usd(payout, 0)}
              </button>
            );
          } else if (!readOnly && !mine && live && card.for_sale) {
            const isBuy = card.kind === "BUY";
            const need = isBuy ? Number(card.ask) : Number(card.collateral);
            const short = free < need;
            actions = (
              <button
                className={`btn flex-1 py-1.5 text-xs ${isBuy ? "btn-primary" : "btn-sell"}`}
                disabled={busy || short}
                title={short ? `Need ${usd(need, 0)} free Portfolio` : undefined}
                onClick={() => run(() => acquireCard(card.id))}
              >
                {isBuy
                  ? `Buy for ${usd(Number(card.ask), 0)}`
                  : `Assume · +${fmtOpt(Number(card.ask))}`}
              </button>
            );
          }

          return (
            <OptionCard
              key={card.id}
              card={card}
              spot={spot}
              meId={uid}
              index={i}
              actions={actions}
              onHistory={() => openHistory(card)}
            />
          );
        })}
      </div>

      <AnimatePresence>
        {listing && (
          <ListDialog
            card={listing}
            onClose={() => setListing(null)}
            onSubmit={async (ask) => {
              const ok = await run(() => listCard(listing.id, ask));
              if (ok) setListing(null);
            }}
          />
        )}
        {history && <HistoryDrawer {...history} onClose={() => setHistory(null)} />}
      </AnimatePresence>
    </>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.94, y: 16 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.94, y: 16 }}
        transition={{ type: "spring", stiffness: 340, damping: 28 }}
        onClick={(e) => e.stopPropagation()}
        className="panel panel-hi w-full max-w-md p-5"
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function ListDialog({
  card,
  onClose,
  onSubmit,
}: {
  card: CardDTO;
  onClose: () => void;
  onSubmit: (ask: number) => void;
}) {
  const isBuy = card.kind === "BUY";
  const [ask, setAsk] = useState(
    isBuy ? Math.round(card.strike * card.amount * 0.1) || 10 : Math.ceil(card.premium * 1.4)
  );

  return (
    <Shell onClose={onClose}>
      <div className="mb-1 flex items-center gap-2">
        <TagIcon size={16} className="text-gold" />
        <h3 className="font-semibold">
          {isBuy ? "Sell this Buy Option" : "Offload this obligation"}
        </h3>
        <button onClick={onClose} className="ml-auto text-mute hover:text-white">
          <X size={16} />
        </button>
      </div>

      <p className="mb-4 text-xs leading-relaxed text-mute">
        {isBuy
          ? "Another player pays this in Portfolio Value and becomes the owner, taking all future rights to the card."
          : `Whoever assumes this card locks ${usd(card.collateral, 0)} of their own Portfolio as collateral and takes on the obligation. You pay them the takeover premium in OPT, and your collateral is released. You originally received ${fmtOpt(card.premium)}.`}
      </p>

      <label className="mb-1.5 block text-xs text-mute">
        {isBuy ? "Asking price (Portfolio $)" : "Takeover premium you pay (OPT)"}
      </label>
      <input
        type="number"
        min={1}
        value={ask}
        onChange={(e) => setAsk(Math.max(0, Number(e.target.value) || 0))}
        className="tabnum mb-4 w-full rounded-xl border border-edge bg-black/40 px-3 py-2.5 font-mono outline-none focus:border-buy"
      />

      <div className="flex gap-2">
        <button className="btn btn-ghost flex-1" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn flex-1 ${isBuy ? "btn-primary" : "btn-sell"}`}
          disabled={!(ask > 0)}
          onClick={() => onSubmit(ask)}
        >
          List it
        </button>
      </div>
    </Shell>
  );
}

function HistoryDrawer({
  card,
  events,
  onClose,
}: {
  card: CardDTO;
  events: CardEventDTO[];
  onClose: () => void;
}) {
  return (
    <Shell onClose={onClose}>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-semibold">
          Card #{card.id} · {card.asset} {card.kind}
        </h3>
        <button onClick={onClose} className="ml-auto text-mute hover:text-white">
          <X size={16} />
        </button>
      </div>
      <p className="mb-3 text-xs text-mute">
        Ownership and premium history is public — see how compensation evolved.
      </p>
      <ol className="max-h-80 space-y-2 overflow-y-auto pr-1">
        {events.map((e) => (
          <li key={e.id} className="rounded-xl border border-edge/70 bg-black/25 px-3 py-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-mono font-semibold text-buy">{e.type}</span>
              <span className="ml-auto text-[10px] text-mute">
                {new Date(e.created_at).toLocaleTimeString()}
              </span>
            </div>
            {(e.from_user || e.to_user) && (
              <div className="mt-0.5 text-mute">
                {e.from_user ?? "—"} → <span className="text-slate-200">{e.to_user ?? "—"}</span>
              </div>
            )}
            {e.note && <div className="mt-0.5 text-slate-300">{e.note}</div>}
          </li>
        ))}
        {!events.length && <li className="py-4 text-center text-mute">No events yet.</li>}
      </ol>
    </Shell>
  );
}
