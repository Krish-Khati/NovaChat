"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Check,
  ChevronDown,
  ChevronsRight,
  LogOut,
  MessageSquare,
  MoreHorizontal,
  Moon,
  Monitor,
  PanelLeft,
  PenLine,
  Pencil,
  Search,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useUIStore } from "@/store/ui-store";
import { toast } from "@/store/toast-store";
import type { Conversation } from "@/lib/types";

/**
 * Left sidebar: brand, New Chat, searchable grouped conversation list,
 * user menu at the bottom. Desktop collapses to an icon rail; mobile
 * renders as an overlay drawer (see MobileSidebar).
 */

function groupOf(c: Conversation): "Today" | "Yesterday" | "Previous 7 days" | "Previous 30 days" | "Older" {
  const startOfDay = (d: number) => {
    const dt = new Date(d);
    return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  };
  const diffDays = Math.round((startOfDay(Date.now()) - startOfDay(c.updatedAt)) / 86_400_000);
  if (diffDays <= 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Previous 7 days";
  if (diffDays <= 30) return "Previous 30 days";
  return "Older";
}

export function SidebarContent({ collapsed = false }: { collapsed?: boolean }) {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const selectConversation = useChatStore((s) => s.selectConversation);
  const newChat = useChatStore((s) => s.newChat);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const renameConversation = useChatStore((s) => s.renameConversation);
  const toggleCollapsed = useUIStore((s) => s.toggleCollapsed);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);

  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    return q
      ? sorted.filter(
          (c) =>
            c.title.toLowerCase().includes(q) ||
            c.messages.some((m) => m.content.toLowerCase().includes(q))
        )
      : sorted;
  }, [conversations, query]);

  const groups = useMemo(() => {
    const map = new Map<string, Conversation[]>();
    for (const c of filtered) {
      const g = groupOf(c);
      if (!map.has(g)) map.set(g, []);
      map.get(g)!.push(c);
    }
    return Array.from(map.entries());
  }, [filtered]);

  /* ------------------------- collapsed rail ------------------------ */
  if (collapsed) {
    return (
      <div className="flex h-full w-[68px] flex-col items-center border-r border-border bg-sidebar py-3">
        <button
          onClick={newChat}
          title="New chat"
          aria-label="New chat"
          className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl text-sidebar-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <PenLine size={18} strokeWidth={1.8} />
        </button>
        <button
          onClick={toggleCollapsed}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className="mb-3 rounded-xl p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ChevronsRight size={18} />
        </button>
        <div className="flex-1 overflow-y-auto overflow-x-hidden w-full px-2">
          <div className="flex flex-col items-center gap-1">
            {filtered.slice(0, 30).map((c) => (
              <button
                key={c.id}
                onClick={() => selectConversation(c.id)}
                title={c.title}
                aria-label={c.title}
                aria-current={c.id === activeId}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                  c.id === activeId && "bg-accent/15 text-accent"
                )}
              >
                <MessageSquare size={16} />
              </button>
            ))}
          </div>
        </div>
        <UserMenu collapsed onSettings={() => setSettingsOpen(true)} />
      </div>
    );
  }

  /* ------------------------- full sidebar -------------------------- */
  return (
    <div className="flex h-full w-[260px] flex-col bg-sidebar text-sidebar-foreground">
      {/* Brand + collapse */}
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Sparkles size={16} />
          </div>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">NovaChat</div>
            <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Personal AI
            </div>
          </div>
        </div>
        <button
          onClick={toggleCollapsed}
          className="hidden rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5 lg:block"
          title="Close sidebar"
          aria-label="Close sidebar"
        >
          <PanelLeft size={17} />
        </button>
      </div>

      {/* New chat */}
      <div className="px-3">
        <button
          onClick={newChat}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
        >
          <PenLine size={16} strokeWidth={1.8} className="text-muted-foreground" />
          New chat
          <kbd className="ml-auto rounded-md px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/70">
            Alt N
          </kbd>
        </button>
      </div>

      {/* Search — a quiet row until clicked (ChatGPT pattern) */}
      <div className="px-2 pb-1 pt-2">
        {searchOpen ? (
          <label className="flex items-center gap-2.5 rounded-lg bg-black/5 px-2.5 py-2 dark:bg-white/5">
            <Search size={16} strokeWidth={1.8} className="shrink-0 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setQuery("");
                  setSearchOpen(false);
                }
              }}
              placeholder="Search chats"
              aria-label="Search chats"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
            <button
              onClick={() => {
                setQuery("");
                setSearchOpen(false);
              }}
              aria-label="Close search"
            >
              <X size={14} className="text-muted-foreground hover:text-foreground" />
            </button>
          </label>
        ) : (
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13.5px] font-medium text-sidebar-foreground transition-colors hover:bg-black/5 dark:hover:bg-white/5"
          >
            <Search size={16} strokeWidth={1.8} className="text-muted-foreground" />
            Search chats
          </button>
        )}
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {groups.length === 0 && (
          <p className="px-3 pt-6 text-center text-xs text-muted-foreground">
            {query ? "No conversations match." : "No conversations yet — say hello."}
          </p>
        )}
        {groups.map(([group, items]) => (
          <div key={group} className="pt-3">
            <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/80">
              {group}
            </div>
            {items.map((c) =>
              editingId === c.id ? (
                <form
                  key={c.id}
                  onSubmit={(e) => {
                    e.preventDefault();
                    renameConversation(c.id, editDraft);
                    setEditingId(null);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1"
                >
                  <input
                    autoFocus
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Escape" && setEditingId(null)}
                    className="w-full rounded-md border border-border bg-card px-2 py-1.5 text-[13px] outline-none"
                  />
                  <button type="submit" aria-label="Save name" className="p-1.5 text-accent">
                    <Check size={14} />
                  </button>
                </form>
              ) : (
                <div
                  key={c.id}
                  className={cn(
                    "group relative flex items-center rounded-lg text-[13px] transition-colors",
                    c.id === activeId
                      ? "bg-black/5 dark:bg-white/5"
                      : "hover:bg-black/5 dark:hover:bg-white/5"
                  )}
                >
                  <button
                    onClick={() => selectConversation(c.id)}
                    aria-current={c.id === activeId}
                    className="flex min-w-0 flex-1 items-center py-2 pl-2.5 pr-9 text-left"
                  >
                    <span className="truncate">{c.title}</span>
                  </button>
                  <div
                    className={cn(
                      "absolute right-1 flex items-center transition-opacity",
                      menuOpenId === c.id
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100 focus-within:opacity-100"
                    )}
                  >
                    <button
                      onClick={() => setMenuOpenId(menuOpenId === c.id ? null : c.id)}
                      title="More options"
                      aria-label="Conversation options"
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === c.id}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-border/50 hover:text-foreground"
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </div>
                  {menuOpenId === c.id && (
                    <ConversationMenu
                      onRename={() => {
                        setMenuOpenId(null);
                        setEditingId(c.id);
                        setEditDraft(c.title);
                      }}
                      onDelete={() => {
                        setMenuOpenId(null);
                        deleteConversation(c.id);
                      }}
                      onClose={() => setMenuOpenId(null)}
                    />
                  )}
                </div>
              )
            )}
          </div>
        ))}
      </div>

      {/* User menu */}
      <div className="border-t border-border p-2">
        <UserMenu onSettings={() => setSettingsOpen(true)} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function ConversationMenu({
  onRename,
  onDelete,
  onClose,
}: {
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      className="absolute right-1.5 top-[calc(100%-2px)] z-40 w-40 overflow-hidden rounded-xl border border-border bg-card p-1 shadow-soft"
    >
      <button
        role="menuitem"
        onClick={onRename}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-foreground transition-colors hover:bg-muted"
      >
        <Pencil size={13} className="text-muted-foreground" /> Rename
      </button>
      <button
        role="menuitem"
        onClick={onDelete}
        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] text-[#e5484d] transition-colors hover:bg-[#e5484d]/10"
      >
        <Trash2 size={13} /> Delete
      </button>
    </div>
  );
}

function UserMenu({
  onSettings,
  collapsed = false,
}: {
  onSettings: () => void;
  collapsed?: boolean;
}) {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  const nextTheme = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  const menu = open && (
    <div
      role="menu"
      className={cn(
        "absolute z-30 w-56 overflow-hidden rounded-2xl border border-border bg-card p-1.5 shadow-soft",
        collapsed ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2"
      )}
    >
      <div className="border-b border-border px-3 py-2">
        <div className="text-[13px] font-semibold">Dhruv Mehta</div>
        <div className="truncate text-[11px] text-muted-foreground">dhruv@novachat.app</div>
      </div>
      <button
        role="menuitem"
        onClick={() => {
          setOpen(false);
          onSettings();
        }}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
      >
        <Settings size={15} className="text-muted-foreground" /> Settings
      </button>
      <button
        role="menuitem"
        onClick={() => setTheme(nextTheme)}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
      >
        <ThemeIcon size={15} className="text-muted-foreground" />
        Theme:
        <span className="ml-auto text-[11px] font-medium uppercase text-muted-foreground">
          {theme}
        </span>
      </button>
      <button
        role="menuitem"
        onClick={() => {
          setOpen(false);
          toast.info("Nothing to log out of", "NovaChat is local-only — there's no account server in Phase 2.");
        }}
        className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] text-foreground transition-colors hover:bg-muted"
      >
        <LogOut size={15} className="text-muted-foreground" /> Log out
      </button>
    </div>
  );

  return (
    <div ref={ref} className={cn("relative", collapsed && "flex flex-col items-center gap-1")}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="User menu"
        className={cn(
          "flex items-center gap-2.5 rounded-2xl text-left transition-colors",
          collapsed
            ? "h-11 w-11 justify-center hover:bg-muted"
            : "w-full px-2 py-2 hover:bg-muted"
        )}
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-accent-hover text-[12px] font-bold text-accent-foreground">
          DM
        </span>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-medium">Dhruv Mehta</span>
              <span className="block text-[10px] text-muted-foreground">Pro plan</span>
            </span>
            <ChevronDown
              size={15}
              className={cn("text-muted-foreground transition-transform duration-200", open && "rotate-180")}
            />
          </>
        )}
      </button>
      <AnimatePresence>{menu}</AnimatePresence>
    </div>
  );
}

/** Mobile overlay drawer wrapper */
export function MobileSidebar() {
  const open = useUIStore((s) => s.sidebarOpen);
  const setOpen = useUIStore((s) => s.setSidebarOpen);

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
            className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[2px] lg:hidden"
          />
          <motion.div
            key="drawer"
            initial={{ x: -300 }}
            animate={{ x: 0 }}
            exit={{ x: -300 }}
            transition={{ type: "spring", damping: 30, stiffness: 300 }}
            className="fixed inset-y-0 left-0 z-50 lg:hidden"
          >
            <SidebarContent />
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
