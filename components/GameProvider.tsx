"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { AssetSymbol } from "@/lib/config";
import type { StateDTO } from "@/lib/types";

type Toast = { id: number; text: string; tone: "ok" | "bad" | "info" };

type Ctx = {
  state: StateDTO | null;
  refresh: () => Promise<void>;
  priceOf: (a: AssetSymbol) => number;
  toast: (text: string, tone?: Toast["tone"]) => void;
  toasts: Toast[];
  /** Wraps a server action: runs it, toasts the outcome, refreshes state. */
  run: <T>(fn: () => Promise<{ ok: boolean; message?: string } & T>, okMsg?: string) => Promise<boolean>;
  busy: boolean;
};

const GameCtx = createContext<Ctx | null>(null);

export function useGame() {
  const c = useContext(GameCtx);
  if (!c) throw new Error("useGame outside provider");
  return c;
}

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<StateDTO | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [busy, setBusy] = useState(false);
  const tid = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/state", { cache: "no-store" });
      if (r.status === 401) {
        window.location.href = "/";
        return;
      }
      if (r.ok) setState(await r.json());
    } catch {
      /* keep last known state; next poll retries */
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++tid.current;
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  // The busy cursor is driven from <body> rather than from a class on each button: an action
  // in flight blocks the whole UI, so the whole UI should say so.
  useEffect(() => {
    document.body.dataset.busy = busy ? "true" : "false";
  }, [busy]);

  const run: Ctx["run"] = useCallback(
    async (fn, okMsg) => {
      setBusy(true);
      try {
        const res = await fn();
        if (res.ok) {
          toast(res.message || okMsg || "Done", "ok");
          await refresh();
          return true;
        }
        toast(res.message || "Something went wrong", "bad");
        return false;
      } catch (e: any) {
        toast(e?.message || "Request failed", "bad");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast]
  );

  const priceOf = useCallback(
    (a: AssetSymbol) => state?.prices.find((p) => p.asset === a)?.price ?? 0,
    [state]
  );

  return (
    <GameCtx.Provider value={{ state, refresh, priceOf, toast, toasts, run, busy }}>
      {children}
    </GameCtx.Provider>
  );
}
