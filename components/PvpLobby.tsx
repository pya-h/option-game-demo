"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check, Clock, Plus, Swords, Trophy, Users, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createMatch, respondInvite } from "@/app/actions/pvp";
import type { LobbyRow } from "@/app/(game)/pvp/page";
import { MATCH_DURATIONS, MAX_MATCH_MINUTES, MIN_MATCH_MINUTES } from "@/lib/config";
import { duration as fmtDuration } from "@/lib/fmt";
import { useGame } from "./GameProvider";
import QuickMatch from "./QuickMatch";

const STATUS = {
  LOBBY: { label: "Waiting", cls: "text-gold bg-gold/15" },
  ACTIVE: { label: "Live", cls: "text-mint bg-mint/15" },
  FINISHED: { label: "Finished", cls: "text-mute bg-white/5" },
};

export default function PvpLobby({ rows, meId }: { rows: LobbyRow[]; meId: number }) {
  const { state, run, busy, refresh } = useGame();
  const router = useRouter();
  const [creating, setCreating] = useState(false);

  const cfg = state?.cfg;
  const invites = rows.filter((r) => r.my_state === "INVITED" && r.status === "LOBBY");
  const others = rows.filter((r) => !(r.my_state === "INVITED" && r.status === "LOBBY"));

  const after = async () => {
    await refresh();
    router.refresh();
  };

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">⚔️ PvP Arena</h1>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-mute">
            A match is a sealed economy. Everyone starts with{" "}
            <span className="text-buy">{cfg?.pvpInitialOpt ?? "—"} PvP OPT</span> and{" "}
            <span className="text-mint">$0 PvP Portfolio</span> — your global balances mean nothing
            inside. Entry costs{" "}
            <span className="text-gold">{cfg?.pvpEnergyCost ?? "—"} Energy</span>, but once the clock
            starts there is no Energy limit: OPT is the only thing holding you back.
          </p>
        </div>
        <button className="btn btn-sell ml-auto" onClick={() => setCreating(true)}>
          <Plus size={14} className="mr-1 inline" />
          New Match
        </button>
      </header>

      {/* Random matchmaking sits alongside username invites rather than replacing them. */}
      <QuickMatch />

      {invites.length > 0 && (
        <section className="panel panel-hi border-sell/40 p-4">
          <h2 className="mb-3 font-semibold text-sell">
            {invites.length} pending invite{invites.length > 1 ? "s" : ""}
          </h2>
          <div className="space-y-2">
            {invites.map((r) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-black/25 px-3.5 py-3"
              >
                <Swords size={16} className="text-sell" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{r.name}</div>
                  <div className="text-[11px] text-mute">
                    by {r.creator} · {fmtDuration(r.duration_min * 60)} · {r.roster}
                  </div>
                </div>
                <button
                  className="btn btn-primary py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => run(() => respondInvite(r.id, true)).then(after)}
                >
                  <Check size={13} className="mr-1 inline" />
                  Accept · −{cfg?.pvpEnergyCost} ⚡
                </button>
                <button
                  className="btn btn-ghost py-1.5 text-xs"
                  disabled={busy}
                  onClick={() => run(() => respondInvite(r.id, false)).then(after)}
                >
                  <X size={13} />
                </button>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      <section className="panel p-4">
        <h2 className="mb-3 flex items-center gap-2 font-semibold">
          <Clock size={16} className="text-buy" /> Your matches
        </h2>
        {others.length ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            {others.map((r, i) => {
              const s = STATUS[r.status];
              return (
                <motion.div
                  key={r.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  <Link
                    href={`/pvp/${r.id}`}
                    className="panel foil block h-full p-3.5 transition hover:border-buy/50"
                  >
                    <div className="mb-1 flex items-center gap-2">
                      {r.mode === "DUEL" ? (
                        <Swords size={14} className="text-sell" />
                      ) : (
                        <Users size={14} className="text-buy" />
                      )}
                      <span className="truncate font-semibold">{r.name}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-[10px] ${s.cls}`}>
                        {s.label}
                      </span>
                    </div>
                    <div className="text-[11px] text-mute">
                      {r.mode === "DUEL" ? "1v1" : "Group"} · {fmtDuration(r.duration_min * 60)} ·{" "}
                      {r.joined} joined
                    </div>
                    <div className="mt-1 truncate text-[11px] text-slate-400">{r.roster}</div>
                    {r.status === "FINISHED" && r.my_rank && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-xs text-gold">
                        <Trophy size={12} /> You placed #{r.my_rank}
                      </div>
                    )}
                  </Link>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <p className="py-8 text-center text-sm text-mute">
            No matches yet. Challenge someone by username →
          </p>
        )}
      </section>

      <AnimatePresence>
        {creating && (
          <CreateDialog
            energy={state?.me.energy ?? 0}
            cost={cfg?.pvpEnergyCost ?? 5}
            onClose={() => setCreating(false)}
            onDone={async (id) => {
              setCreating(false);
              await after();
              router.push(`/pvp/${id}`);
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function CreateDialog({
  energy,
  cost,
  onClose,
  onDone,
}: {
  energy: number;
  cost: number;
  onClose: () => void;
  onDone: (id: number) => void;
}) {
  const { toast } = useGame();
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"DUEL" | "GROUP">("DUEL");
  const [name, setName] = useState("");
  const [presetDur, setPresetDur] = useState(15);
  const [customDur, setCustomDur] = useState(false);
  const [customDurVal, setCustomDurVal] = useState(45);
  const [names, setNames] = useState("");

  // A match is capped where the main game isn't: it holds a sealed economy open, and every
  // card inside it has to resolve before the whistle.
  const duration = customDur ? Math.round(customDurVal) : presetDur;
  const durationError =
    duration < MIN_MATCH_MINUTES
      ? `Shortest match is ${MIN_MATCH_MINUTES} minutes`
      : duration > MAX_MATCH_MINUTES
        ? `Longest match is ${MAX_MATCH_MINUTES / 60} hours`
        : null;

  const usernames = names
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const valid =
    usernames.length > 0 &&
    (mode === "DUEL" ? usernames.length === 1 : true) &&
    energy >= cost &&
    !durationError;

  const submit = async () => {
    setBusy(true);
    try {
      const res = await createMatch({ mode, name, durationMin: duration, usernames });
      toast(res.message ?? (res.ok ? "Match created" : "Failed"), res.ok ? "ok" : "bad");
      if (res.ok && res.matchId) onDone(res.matchId);
    } finally {
      setBusy(false);
    }
  };

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
        onClick={(e) => e.stopPropagation()}
        className="panel panel-hi w-full max-w-md p-5"
      >
        <div className="mb-4 flex items-center gap-2">
          <Swords size={16} className="text-sell" />
          <h3 className="font-semibold">Create a match</h3>
          <button onClick={onClose} className="ml-auto text-mute hover:text-white">
            <X size={16} />
          </button>
        </div>

        <div className="mb-3 flex rounded-xl border border-edge p-0.5">
          {(["DUEL", "GROUP"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-lg py-1.5 text-xs font-semibold transition ${
                mode === m ? "bg-sell/20 text-sell" : "text-mute hover:text-slate-200"
              }`}
            >
              {m === "DUEL" ? "1v1 Duel" : "Group Arena"}
            </button>
          ))}
        </div>

        <label className="mb-1 block text-xs text-mute">Match name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="BTC Arena"
          className="mb-3 w-full rounded-xl border border-edge bg-black/40 px-3 py-2 text-sm outline-none focus:border-sell"
        />

        <label className="mb-1 block text-xs text-mute">
          {mode === "DUEL" ? "Opponent username" : "Player usernames (comma or space separated)"}
        </label>
        <input
          value={names}
          onChange={(e) => setNames(e.target.value)}
          placeholder={mode === "DUEL" ? "bob" : "bob, sarah, john"}
          className="mb-3 w-full rounded-xl border border-edge bg-black/40 px-3 py-2 font-mono text-sm outline-none focus:border-sell"
        />

        <div className="mb-1.5 flex items-baseline gap-2 text-xs">
          <span className="text-mute">Duration</span>
          <span className="tabnum ml-auto font-mono text-slate-200">
            {durationError ? "—" : fmtDuration(duration * 60)}
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {MATCH_DURATIONS.map((d) => (
            <button
              key={d}
              data-on={!customDur && duration === d}
              onClick={() => {
                setCustomDur(false);
                setPresetDur(d);
              }}
              className="chip"
            >
              {fmtDuration(d * 60)}
            </button>
          ))}
          <button data-on={customDur} onClick={() => setCustomDur((v) => !v)} className="chip">
            custom
          </button>
        </div>
        {customDur && (
          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="number"
              min={MIN_MATCH_MINUTES}
              max={MAX_MATCH_MINUTES}
              value={customDurVal}
              onChange={(e) => setCustomDurVal(Math.max(0, Number(e.target.value) || 0))}
              className="tabnum w-full rounded-lg border border-edge bg-black/40 px-2.5 py-1.5 text-center font-mono text-sm outline-none focus:border-sell"
            />
            <span className="text-xs text-mute">min</span>
          </div>
        )}
        <div className="mb-4 mt-1 text-[10px] text-danger">{durationError ?? ""}</div>

        <p className="mb-3 text-[11px] text-mute">
          Creating joins you immediately and costs <span className="text-gold">{cost} Energy</span>{" "}
          (you have {Math.floor(energy)}). Invited players pay the same when they accept.
        </p>

        <button className="btn btn-sell w-full" disabled={!valid || busy} onClick={submit}>
          {energy < cost
            ? `Need ${cost} Energy`
            : mode === "DUEL" && usernames.length !== 1
              ? "Enter exactly one opponent"
              : !usernames.length
                ? "Enter at least one username"
                : "Create & invite"}
        </button>
      </motion.div>
    </motion.div>
  );
}
