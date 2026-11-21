"use client";

import { create } from "zustand";
import { uid } from "@/lib/id";

export type ToastKind = "error" | "warn" | "info";
export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, title: string, detail?: string) => void;
  dismiss: (id: string) => void;
}

/** Minimal global toast bus. Auto-dismiss is handled by the Toaster UI. */
export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  push: (kind, title, detail) =>
    set((s) => ({
      toasts: [...s.toasts.slice(-2), { id: uid(), kind, title, detail }],
    })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Convenience for non-React code (stores): import this, call directly. */
export const toast = {
  error: (title: string, detail?: string) =>
    useToastStore.getState().push("error", title, detail),
  warn: (title: string, detail?: string) =>
    useToastStore.getState().push("warn", title, detail),
  info: (title: string, detail?: string) =>
    useToastStore.getState().push("info", title, detail),
};
