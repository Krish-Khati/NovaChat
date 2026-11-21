"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Check,
  Cpu,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Monitor,
  Moon,
  Play,
  Square,
  Sun,
  Volume2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { CARTESIA_VOICES, GROQ_MODELS } from "@/lib/data";
import { speakText, stopSpeakingAudio } from "@/lib/client";
import { toast } from "@/store/toast-store";
import { useSettingsStore, type ApiKeys } from "@/store/settings-store";
import { useUIStore } from "@/store/ui-store";
import { Switch } from "@/components/ui/switch";

/**
 * Settings slide-over. Model + voice (with real TTS preview), web-search default,
 * theme, and Phase-1-only API key fields (in-memory, masked).
 */
export function SettingsPanel() {
  const open = useUIStore((s) => s.settingsOpen);
  const setOpen = useUIStore((s) => s.setSettingsOpen);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px]"
          />
          <motion.aside
            key="panel"
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            role="dialog"
            aria-modal="true"
            aria-label="Settings"
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l border-border bg-card text-card-foreground shadow-soft"
          >
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <div>
                <h2 className="text-base font-semibold tracking-tight">Settings</h2>
                <p className="text-[11px] text-muted-foreground">
                  NovaChat prefers sane defaults — tweak only what matters.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-xl p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Close settings"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              <ModelSection />
              <VoiceSection />
              <SearchSection />
              <ThemeSection />
              <ApiKeysSection />
            </div>

            <div className="border-t border-border px-6 py-3 text-center text-[10px] text-muted-foreground">
              NovaChat · Groq / Cartesia / SerpApi, proxied through local API routes · v0.2.0
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h3 className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        <Icon size={12} /> {title}
      </h3>
      {children}
    </section>
  );
}

function ModelSection() {
  const model = useSettingsStore((s) => s.model);
  const setModel = useSettingsStore((s) => s.setModel);
  return (
    <Section title="Model" icon={Cpu}>
      <div className="grid gap-2">
        {GROQ_MODELS.map((m) => {
          const active = model === m.id;
          return (
            <button
              key={m.id}
              onClick={() => setModel(m.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-3 rounded-2xl border p-3 text-left transition-all",
                active
                  ? "border-accent/60 bg-accent/8 ring-1 ring-accent/50"
                  : "border-border hover:border-muted-foreground/40 hover:bg-muted/50"
              )}
            >
              <span
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl",
                  active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <Bot size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">{m.label}</span>
                <span className="block text-[11px] text-muted-foreground">{m.description}</span>
              </span>
              {active && <Check size={16} className="shrink-0 text-accent" />}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

function VoiceSection() {
  const voiceId = useSettingsStore((s) => s.voiceId);
  const setVoiceId = useSettingsStore((s) => s.setVoiceId);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const previewReq = useRef(0);

  // Stop any in-flight preview when the panel unmounts
  useEffect(() => () => stopSpeakingAudio(), []);

  const preview = (id: string) => {
    if (previewing === id) {
      stopSpeakingAudio();
      previewReq.current += 1;
      setPreviewing(null);
      return;
    }
    stopSpeakingAudio();
    const myReq = ++previewReq.current;
    setPreviewing(id);
    // Real Cartesia TTS through /api/tts — short fixed sentence
    void speakText(
      `Hi, I'm Nova. This is how I sound. Ask me anything — out loud.`,
      id
    ).then((result) => {
      if (previewReq.current !== myReq) return; // superseded by another preview
      setPreviewing(null);
      if (result.status === "error") {
        toast.error("Voice preview failed", result.message);
      }
    });
  };

  return (
    <Section title="Voice (Cartesia)" icon={Volume2}>
      <div className="overflow-hidden rounded-2xl border border-border">
        {CARTESIA_VOICES.map((v, i) => {
          const active = voiceId === v.id;
          const isPreviewing = previewing === v.id;
          return (
            <div
              key={v.id}
              className={cn(
                "flex items-center gap-3 bg-card px-3 py-2.5 transition-colors",
                i > 0 && "border-t border-border",
                active && "bg-accent/8"
              )}
            >
              <button
                onClick={() => setVoiceId(v.id)}
                aria-pressed={active}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    "h-2.5 w-2.5 shrink-0 rounded-full transition-colors",
                    active ? "bg-accent" : "bg-border"
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-tight">{v.name}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">
                    {v.tone}
                  </span>
                </span>
              </button>
              <button
                onClick={() => preview(v.id)}
                aria-label={isPreviewing ? `Stop previewing ${v.name}` : `Preview ${v.name}`}
                title="Preview voice"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all",
                  isPreviewing
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-border text-muted-foreground hover:border-accent/50 hover:text-accent"
                )}
              >
                {isPreviewing ? <Square size={11} fill="currentColor" /> : <Play size={12} className="ml-0.5" fill="currentColor" />}
              </button>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function SearchSection() {
  const searchByDefault = useSettingsStore((s) => s.searchByDefault);
  const setSearchByDefault = useSettingsStore((s) => s.setSearchByDefault);
  return (
    <Section title="Grounding" icon={Globe}>
      <div className="flex items-center justify-between gap-4 rounded-2xl border border-border p-3.5">
        <div className="min-w-0">
          <div className="text-[13px] font-medium">Search the web by default</div>
          <div className="text-[11px] leading-snug text-muted-foreground">
            Every reply starts with a Google Search pass. You can still toggle it
            per message with the pill in the composer.
          </div>
        </div>
        <Switch
          checked={searchByDefault}
          onCheckedChange={setSearchByDefault}
          ariaLabel="Enable Google Search grounding by default"
        />
      </div>
    </Section>
  );
}

function ThemeSection() {
  const { theme, setTheme } = useTheme();
  const options = [
    { id: "light", label: "Light", icon: Sun },
    { id: "dark", label: "Dark", icon: Moon },
    { id: "system", label: "System", icon: Monitor },
  ] as const;
  return (
    <Section title="Appearance" icon={Sun}>
      <div
        role="radiogroup"
        aria-label="Theme"
        className="grid grid-cols-3 gap-1.5 rounded-2xl border border-border bg-muted/50 p-1.5"
      >
        {options.map(({ id, label, icon: Icon }) => {
          const active = theme === id;
          return (
            <button
              key={id}
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(id)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-xl px-3 py-2.5 text-[12px] font-medium transition-all",
                active
                  ? "bg-card text-accent shadow-lift"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={17} />
              {label}
            </button>
          );
        })}
      </div>
    </Section>
  );
}

const KEY_FIELDS: {
  field: keyof ApiKeys;
  label: string;
  hint: string;
  placeholder: string;
}[] = [
  { field: "groq", label: "Groq API key", hint: "Chat completions (GPT-OSS)", placeholder: "gsk_…" },
  { field: "cartesia", label: "Cartesia API key", hint: "Voice TTS + STT", placeholder: "sk_car_…" },
  { field: "serpapi", label: "SerpApi key", hint: "Google Search grounding", placeholder: "serpapi key…" },
];

function ApiKeysSection() {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const clearApiKeys = useSettingsStore((s) => s.clearApiKeys);
  const [visible, setVisible] = useState<Partial<Record<keyof ApiKeys, boolean>>>({});

  return (
    <Section title="API keys" icon={KeyRound}>
      <div className="rounded-2xl border border-dashed border-accent/40 bg-accent/5 p-3">
        <p className="mb-3 text-[11px] leading-snug text-muted-foreground">
          <span className="font-semibold text-accent">Keys stay on this device.</span> They are
          held in memory only, sent exclusively to the NovaChat API routes running locally in
          this app (never to third parties from the browser), and cleared on reload. Server-side
          <code className="mx-1 rounded bg-muted px-1 font-mono text-[10px]">.env.local</code>
          values take precedence when set.
        </p>
        <div className="flex flex-col gap-2.5">
          {KEY_FIELDS.map(({ field, label, hint, placeholder }) => {
            const show = !!visible[field];
            return (
              <label key={field} className="block">
                <span className="mb-1 flex items-baseline justify-between text-[11px] font-medium text-foreground">
                  {label}
                  <span className="font-normal text-muted-foreground">{hint}</span>
                </span>
                <span className="flex items-center overflow-hidden rounded-xl border border-border bg-card focus-within:border-accent/50">
                  <input
                    type={show ? "text" : "password"}
                    autoComplete="off"
                    spellCheck={false}
                    value={apiKeys[field]}
                    placeholder={placeholder}
                    onChange={(e) => setApiKey(field, e.target.value)}
                    className="w-full bg-transparent px-3 py-2 font-mono text-[12px] outline-none placeholder:text-muted-foreground/50"
                    aria-label={label}
                  />
                  <button
                    type="button"
                    onClick={() => setVisible((v) => ({ ...v, [field]: !show }))}
                    className="p-2 text-muted-foreground hover:text-foreground"
                    aria-label={show ? `Hide ${label}` : `Show ${label}`}
                  >
                    {show ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </span>
              </label>
            );
          })}
        </div>
        {(apiKeys.groq || apiKeys.cartesia || apiKeys.serpapi) && (
          <button
            onClick={clearApiKeys}
            className="mt-2.5 text-[11px] font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
          >
            Clear all keys
          </button>
        )}
      </div>
    </Section>
  );
}
