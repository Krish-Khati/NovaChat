"use client";

import { useEffect, useState } from "react";
import { Menu, Phone, Share2, Sparkles, Settings } from "lucide-react";
import { toast } from "@/store/toast-store";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";
import { useUIStore } from "@/store/ui-store";
import { useVoiceStore } from "@/store/voice-store";
import { ModelSwitcher } from "./model-switcher";
import { SidebarContent, MobileSidebar } from "./sidebar";
import { ChatView } from "./chat-view";
import { Welcome } from "./welcome";
import { SettingsPanel } from "@/components/settings/settings-panel";
import { VoiceMode } from "@/components/voice/voice-mode";
import { Toaster } from "@/components/ui/toaster";

/**
 * App shell: sidebar rail (desktop) / drawer (mobile) + top bar +
 * transcript/welcome/stub + slide-over settings + fullscreen voice takeover.
 * Rehydrates persisted stores after mount to avoid SSR mismatch.
 */
export function ChatShell() {
  const activeId = useChatStore((s) => s.activeId);
  const collapsed = useUIStore((s) => s.collapsed);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const openVoice = useVoiceStore((s) => s.openVoice);
  const newChat = useChatStore((s) => s.newChat);
  const [stubView, setStubView] = useState<string | null>(null);

  useEffect(() => {
    void useChatStore.persist.rehydrate();
    void useSettingsStore.persist.rehydrate();
  }, []);

  // Alt+N → new chat (shortcut noted in the New chat tooltip)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && (e.key === "n" || e.key === "N")) {
        e.preventDefault();
        setStubView(null);
        newChat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChat]);

  /** Sidebar nav: label → stub view (and clear any active chat); null → welcome. */
  const handleNav = (view: string | null) => {
    setStubView(view);
    if (view) newChat();
    setSidebarOpen(false); // close the mobile drawer on any choice
  };

  const share = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.info("Link copied", "Paste it anywhere to open this NovaChat session.");
    } catch {
      toast.warn("Couldn't copy", "Clipboard access was blocked by the browser.");
    }
  };

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* Desktop sidebar */}
      <aside className="hidden shrink-0 lg:block" aria-label="Sidebar">
        <SidebarContent collapsed={collapsed} />
      </aside>
      <MobileSidebar />

      {/* Main column */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* Top bar — borderless: chat gets the model picker + actions;
            home gets a plan pill + settings, nothing else */}
        <header className="flex h-12 shrink-0 items-center gap-2 px-3 sm:px-4">
          <button
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5 lg:hidden"
            aria-label="Open sidebar"
          >
            <Menu size={19} />
          </button>

          {activeId ? (
            <>
              <ModelSwitcher />

              <div className="flex-1" />

              {/* Voice mode trigger */}
              <button
                onClick={openVoice}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-accent dark:hover:bg-white/5"
                aria-label="Start voice conversation"
                title="Voice conversation"
              >
                <Phone size={17} strokeWidth={1.8} />
                <span className="hidden text-[13px] font-medium sm:inline">Voice</span>
              </button>

              {/* Share */}
              <button
                onClick={share}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                aria-label="Copy link to this chat"
                title="Share"
              >
                <Share2 size={17} strokeWidth={1.8} />
                <span className="hidden text-[13px] font-medium sm:inline">Share</span>
              </button>

              {/* Our mark — not anyone else's */}
              <div
                className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-accent-foreground"
                aria-label="NovaChat"
                role="img"
              >
                <Sparkles size={14} />
              </div>
            </>
          ) : (
            <>
              <div className="flex-1" />
              {/* Plan/promo pill */}
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground">
                <Sparkles size={12} className="text-accent" />
                Pro plan
              </span>
              <button
                onClick={() => setSettingsOpen(true)}
                className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
                aria-label="Open settings"
                title="Settings"
              >
                <Settings size={17} strokeWidth={1.8} />
              </button>
            </>
          )}
        </header>

        {/* Surface */}
        {activeId ? (
          <ChatView />
        ) : stubView ? (
          <StubView name={stubView} onBack={() => setStubView(null)} />
        ) : (
          <Welcome />
        )}
      </main>

      <SettingsPanel />
      <VoiceMode />
      <Toaster />
    </div>
  );
}

/** Placeholder for sidebar sections that aren't built yet. */
function StubView({ name, onBack }: { name: string; onBack: () => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/12 text-accent">
        <Sparkles size={24} />
      </div>
      <h1 className="text-2xl font-semibold tracking-tight">{name}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Coming soon — this section isn&apos;t built yet.
      </p>
      <button
        onClick={onBack}
        className="mt-1 rounded-full border border-border bg-card px-4 py-2 text-[13px] font-medium transition-colors hover:bg-muted"
      >
        Back to chat
      </button>
    </div>
  );
}
