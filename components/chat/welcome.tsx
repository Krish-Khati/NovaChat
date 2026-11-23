"use client";

import { Code2, Globe, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { SUGGESTED_PROMPTS } from "@/lib/data";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";
import { InputBar } from "./input-bar";

const ICONS: Record<string, LucideIcon> = {
  Sparkles,
  Code2,
  Globe,
  PenLine,
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Home / empty state: time-aware greeting, the wide pill composer right
 * under it (Ask NovaChat + Think + mic + voice button), then the
 * suggestion prompts as simple icon rows.
 */
export function Welcome() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const searchByDefault = useSettingsStore((s) => s.searchByDefault);

  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-8">
      <div className="flex w-full max-w-[840px] flex-col">
        <h1 className="text-center text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
          {greeting()}, Dhruv. What can I help with today?
        </h1>

        {/* Wide pill composer, directly under the heading */}
        <div className="mt-6">
          <InputBar variant="home" />
        </div>

        {/* Suggestion rows — icon + text, stacked, subtle hover */}
        <div className="mt-3 flex flex-col" role="list">
          {SUGGESTED_PROMPTS.map((s) => {
            const Icon = ICONS[s.icon] ?? Sparkles;
            return (
              <button
                key={s.id}
                role="listitem"
                onClick={() => sendMessage(s.prompt, { webSearch: searchByDefault })}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[13.5px] text-foreground transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:bg-white/5"
              >
                <Icon size={16} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
                <span className="truncate">{s.title}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
