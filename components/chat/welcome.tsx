"use client";

import { Compass, Code2, Newspaper, PenLine, Sparkles, type LucideIcon } from "lucide-react";
import { SUGGESTED_PROMPTS } from "@/lib/data";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";

const ICONS: Record<string, LucideIcon> = {
  Compass,
  Code2,
  Newspaper,
  PenLine,
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Empty state: centered mark, time-aware greeting, suggestion cards. */
export function Welcome() {
  const sendMessage = useChatStore((s) => s.sendMessage);
  const searchByDefault = useSettingsStore((s) => s.searchByDefault);

  return (
    <div className="flex flex-1 flex-col items-center justify-center overflow-y-auto px-4 py-10">
      <div className="flex w-full max-w-2xl flex-col items-center text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-3xl bg-accent text-accent-foreground shadow-soft">
          <Sparkles size={28} strokeWidth={2} />
        </div>
        <h1 className="text-[28px] font-semibold leading-tight tracking-tight sm:text-4xl">
          {greeting()}, Dhruv.
        </h1>
        <p className="mt-2 text-sm text-muted-foreground sm:text-[15px]">
          Ask anything — NovaChat streams answers, cites the web, and speaks.
        </p>

        <div className="mt-8 grid w-full grid-cols-1 gap-2.5 sm:grid-cols-2">
          {SUGGESTED_PROMPTS.map((s) => {
            const Icon = ICONS[s.icon] ?? Compass;
            return (
              <button
                key={s.id}
                onClick={() => sendMessage(s.prompt, { webSearch: searchByDefault })}
                className="group flex flex-col items-start gap-2 rounded-2xl border border-border bg-card p-4 text-left shadow-lift transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/45 hover:shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/12 text-accent transition-colors group-hover:bg-accent group-hover:text-accent-foreground">
                  <Icon size={16} />
                </span>
                <span className="text-[13.5px] font-medium leading-snug text-foreground">
                  {s.title}
                </span>
                <span className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                  {s.prompt}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

