"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { CARTESIA_VOICES, DEFAULT_MODEL, DEFAULT_VOICE_ID, GROQ_MODELS } from "@/lib/data";

/**
 * Settings store.
 * - model / voiceId / searchByDefault persist to localStorage.
 * - apiKeys are IN-MEMORY ONLY — sent solely to NovaChat's own /api routes
 *   as a fallback when server env vars are unset. Never persisted, never
 *   sent to any third party. Server env (.env.local) takes precedence.
 * Theme itself is owned by next-themes.
 */

export interface ApiKeys {
  groq: string;
  cartesia: string;
  serpapi: string;
}

interface SettingsState {
  model: string;
  voiceId: string;
  searchByDefault: boolean;
  apiKeys: ApiKeys;

  setModel: (model: string) => void;
  setVoiceId: (voiceId: string) => void;
  setSearchByDefault: (v: boolean) => void;
  setApiKey: (field: keyof ApiKeys, value: string) => void;
  clearApiKeys: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      model: DEFAULT_MODEL,
      voiceId: DEFAULT_VOICE_ID,
      searchByDefault: false,
      apiKeys: { groq: "", cartesia: "", serpapi: "" },

      setModel: (model) => set({ model }),
      setVoiceId: (voiceId) => set({ voiceId }),
      setSearchByDefault: (searchByDefault) => set({ searchByDefault }),
      setApiKey: (field, value) =>
        set((s) => ({ apiKeys: { ...s.apiKeys, [field]: value } })),
      clearApiKeys: () => set({ apiKeys: { groq: "", cartesia: "", serpapi: "" } }),
    }),
    {
      name: "novachat-settings",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true,
      partialize: (s) => ({
        model: s.model,
        voiceId: s.voiceId,
        searchByDefault: s.searchByDefault,
        // apiKeys intentionally NOT persisted
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<SettingsState> | undefined;
        const voiceId =
          p?.voiceId && CARTESIA_VOICES.some((v) => v.id === p.voiceId)
            ? p.voiceId
            : current.voiceId;
        const model =
          p?.model && GROQ_MODELS.some((m) => m.id === p.model)
            ? p.model
            : current.model;
        return { ...current, ...p, voiceId, model };
      },
    }
  )
);
