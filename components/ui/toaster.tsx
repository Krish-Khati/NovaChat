"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertCircle, Info, TriangleAlert, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToastStore, type Toast } from "@/store/toast-store";

const ICONS = {
  error: AlertCircle,
  warn: TriangleAlert,
  info: Info,
} as const;

const ACCENTS = {
  error: "text-[#e5484d] border-[#e5484d]/40",
  warn: "text-amber-500 border-amber-500/40",
  info: "text-accent border-accent/40",
} as const;

/** Minimal global toast viewport — bottom-right, auto-dismisses in 4.5s. */
export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[min(92vw,360px)] flex-col gap-2"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useToastStore((s) => s.dismiss);
  const Icon = ICONS[toast.kind];

  useEffect(() => {
    const t = window.setTimeout(() => dismiss(toast.id), 4500);
    return () => window.clearTimeout(t);
  }, [toast.id, dismiss]);

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 48, scale: 0.96 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 32 }}
      className={cn(
        "pointer-events-auto flex items-start gap-2.5 rounded-2xl border bg-card p-3 shadow-soft",
        ACCENTS[toast.kind]
      )}
      role="alert"
    >
      <Icon size={17} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] font-medium leading-snug text-foreground">
          {toast.title}
        </p>
        {toast.detail && (
          <p className="mt-0.5 break-words text-[11px] leading-snug text-muted-foreground">
            {toast.detail}
          </p>
        )}
      </div>
      <button
        onClick={() => dismiss(toast.id)}
        className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </motion.div>
  );
}
