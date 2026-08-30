"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, XCircle } from "lucide-react";
import { useGame } from "./GameProvider";

const tones = {
  ok: { icon: CheckCircle2, cls: "border-mint/50 text-mint" },
  bad: { icon: XCircle, cls: "border-danger/50 text-danger" },
  info: { icon: Info, cls: "border-buy/50 text-buy" },
};

export default function Toaster() {
  const { toasts } = useGame();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-[min(92vw,26rem)] flex-col gap-2">
      <AnimatePresence>
        {toasts.map((t) => {
          const { icon: Icon, cls } = tones[t.tone];
          return (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.95 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 40, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className={`panel panel-hi flex items-start gap-2.5 border px-4 py-3 text-sm ${cls}`}
            >
              <Icon size={16} className="mt-0.5 shrink-0" />
              <span className="text-slate-200">{t.text}</span>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
