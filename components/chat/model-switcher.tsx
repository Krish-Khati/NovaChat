"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { GROQ_MODELS } from "@/lib/data";
import { useSettingsStore } from "@/store/settings-store";

/**
 * Top-left model switcher — plain text + chevron, like ChatGPT's.
 * Click to reveal the two Groq options with a checkmark on the active one.
 */
export function ModelSwitcher() {
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const active = GROQ_MODELS.find((m) => m.id === model) ?? GROQ_MODELS[0];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[14px] font-medium text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
      >
        {active.label}
        <ChevronDown
          size={14}
          className={cn("transition-transform duration-150", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-40 mt-1 w-64 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-soft"
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Models
          </div>
          {GROQ_MODELS.map((m) => {
            const isActive = m.id === model;
            return (
              <button
                key={m.id}
                role="menuitemradio"
                aria-checked={isActive}
                onClick={() => {
                  setModel(m.id);
                  setOpen(false);
                }}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                <span className="min-w-0 flex-1">
                  <span className="block text-[13px] font-medium leading-tight">
                    {m.label}
                  </span>
                  <span className="block text-[10.5px] text-muted-foreground">
                    {m.description}
                  </span>
                </span>
                {isActive && <Check size={15} className="shrink-0 text-accent" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
