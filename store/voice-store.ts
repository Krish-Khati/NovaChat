"use client";

import { create } from "zustand";

/**
 * Voice-to-voice mode state. Real pipeline (Phase 2):
 *   mic → MediaRecorder → /api/stt (Cartesia) → /api/chat (Groq SSE)
 *   → /api/tts (Cartesia) → playback. Captions accumulate for the live
 *   transcript. Not persisted.
 */
export type VoiceStatus = "listening" | "transcribing" | "thinking" | "speaking";

export interface VoiceCaption {
  id: string;
  speaker: "user" | "assistant";
  text: string;
  done: boolean;
}

interface VoiceState {
  open: boolean;
  muted: boolean;
  status: VoiceStatus;
  captions: VoiceCaption[];

  openVoice: () => void;
  closeVoice: () => void;
  toggleMute: () => void;
  setStatus: (status: VoiceStatus) => void;
  startCaption: (id: string, speaker: "user" | "assistant") => void;
  appendCaption: (id: string, accumulated: string) => void;
  finishCaption: (id: string, finalText: string) => void;
  reset: () => void;
}

export const useVoiceStore = create<VoiceState>()((set) => ({
  open: false,
  muted: false,
  status: "listening",
  captions: [],

  openVoice: () => set({ open: true, muted: false, status: "listening", captions: [] }),
  closeVoice: () => set({ open: false, muted: false, status: "listening", captions: [] }),
  toggleMute: () => set((s) => ({ muted: !s.muted })),
  setStatus: (status) => set({ status }),

  startCaption: (id, speaker) =>
    set((s) => ({
      captions: [...s.captions, { id, speaker, text: "", done: false }],
    })),

  appendCaption: (id, accumulated) =>
    set((s) => ({
      captions: s.captions.map((c) =>
        c.id === id ? { ...c, text: accumulated } : c
      ),
    })),

  finishCaption: (id, finalText) =>
    set((s) => ({
      captions: s.captions.map((c) =>
        c.id === id ? { ...c, text: finalText, done: true } : c
      ),
    })),

  reset: () => set({ muted: false, status: "listening", captions: [] }),
}));
