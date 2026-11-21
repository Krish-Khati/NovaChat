"use client";

import { create } from "zustand";

/**
 * Ephemeral UI chrome state: sidebar rail collapse (desktop),
 * mobile drawer, settings slide-over.
 * Not persisted — session-level chrome.
 */
interface UIState {
  /** Desktop: icon-only rail */
  collapsed: boolean;
  /** Mobile: drawer visible */
  sidebarOpen: boolean;
  settingsOpen: boolean;

  toggleCollapsed: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSettingsOpen: (open: boolean) => void;
}

export const useUIStore = create<UIState>()((set) => ({
  collapsed: false,
  sidebarOpen: false,
  settingsOpen: false,

  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
