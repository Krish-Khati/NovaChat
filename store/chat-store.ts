"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { uid } from "@/lib/id";
import { streamChat, streamVision, speakText, stopSpeakingAudio } from "@/lib/client";
import { toast } from "@/store/toast-store";
import { useSettingsStore } from "@/store/settings-store";
import type { Conversation, Message, WebSearchPhase, Citation } from "@/lib/types";

/**
 * Chat store. Persists ONLY conversations + activeId to localStorage.
 * Real streaming comes from /api/chat (Groq, SSE) — this store is the seam.
 */

let currentAbort: AbortController | null = null;
let speakingRequestId = 0;

type Set = (
  partial:
    | Partial<ChatState>
    | ((s: ChatState) => Partial<ChatState>),
  replace?: false
) => void;
type Get = () => ChatState;

async function runAssistantReply(
  convId: string,
  userText: string,
  webSearch: boolean,
  set: Set,
  get: Get,
  /** Present → vision turn: image goes to /api/vision instead of /api/chat. */
  imageUrl?: string
) {
  let assistantId: string | null = null;
  let acc = "";

  const ensureAssistant = (): string => {
    if (assistantId) return assistantId;
    assistantId = uid();
    const placeholder: Message = {
      id: assistantId,
      role: "assistant",
      content: "",
      createdAt: Date.now(),
      status: "streaming",
    };
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId ? { ...c, messages: [...c.messages, placeholder] } : c
      ),
    }));
    return assistantId;
  };

  const patchAssistant = (patch: Partial<Message>) => {
    if (!assistantId) return;
    const id = assistantId;
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? {
              ...c,
              messages: c.messages.map((m) => (m.id === id ? { ...m, ...patch } : m)),
            }
          : c
      ),
    }));
  };

  set({
    isStreaming: true,
    webSearchPhase: imageUrl ? "thinking" : webSearch ? "searching" : "thinking",
  });

  const conv = get().conversations.find((c) => c.id === convId);
  // Vision turns carry their image on the current message only — prior turns
  // (and any earlier image messages) pass through as plain text.
  const history = (conv?.messages ?? [])
    .filter((m) => m.content.trim() && (!imageUrl || !m.imageUrl))
    .map((m) => ({ role: m.role, content: m.content }))
    .slice(-24);

  const { model } = useSettingsStore.getState();
  const controller = new AbortController();
  currentAbort = controller;

  const handlers: Parameters<typeof streamChat>[1] = {
    onPhase: (value) => set({ webSearchPhase: value }),
    onMeta: (meta) => {
      ensureAssistant();
      patchAssistant({
        citations: meta.citations ?? [],
        webSearched: !!meta.webSearched,
      });
      if (meta.warning) toast.warn("Web search skipped", meta.warning);
    },
    onDelta: (delta) => {
      acc += delta;
      ensureAssistant();
      patchAssistant({ content: acc });
    },
    onError: (message) => {
      ensureAssistant();
      patchAssistant({ error: message, status: "done" });
      toast.error("NovaChat hit a snag", message);
    },
    onDone: () => {
      const aborted = controller.signal.aborted;
      if (!assistantId) {
        if (!aborted) {
          ensureAssistant();
          patchAssistant({
            status: "done",
            error: "Empty response — the model returned nothing. Try again.",
          });
        }
      } else {
        patchAssistant({ status: "done" });
      }
      set({ isStreaming: false, webSearchPhase: "idle" });
      if (currentAbort === controller) currentAbort = null;
    },
  };

  if (imageUrl) {
    await streamVision({ prompt: userText, imageUrl, history }, handlers, controller.signal);
  } else {
    await streamChat({ messages: history, webSearch, model }, handlers, controller.signal);
  }
}

/* ------------------------------------------------------------------ */
/* Image generation (Pollinations via /api/image-gen)                  */
/* ------------------------------------------------------------------ */

/** Fetch a generated image URL; throws a user-facing message on failure. */
async function fetchGeneratedImage(prompt: string, signal?: AbortSignal): Promise<string> {
  // Random seed → each call/Regenerate is a fresh variation
  const seed = Math.floor(Math.random() * 1_000_000);
  const url = `/api/image-gen?prompt=${encodeURIComponent(prompt)}&seed=${seed}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    let message = `Image generation failed (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (j?.message) message = j.message;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(message);
  }
  return url;
}

/** Drive (or re-drive) one assistant image message: pending → image | error. */
async function runImageGen(convId: string, assistantId: string, prompt: string, set: Set) {
  const controller = new AbortController();
  currentAbort = controller;
  const patch = (p: Partial<Message>) =>
    set((s) => ({
      conversations: s.conversations.map((c) =>
        c.id === convId
          ? { ...c, messages: c.messages.map((m) => (m.id === assistantId ? { ...m, ...p } : m)) }
          : c
      ),
    }));

  try {
    const url = await fetchGeneratedImage(prompt, controller.signal);
    patch({ imageUrl: url, imagePending: false, status: "done", error: undefined });
  } catch (err) {
    if (controller.signal.aborted) {
      patch({ imagePending: false, status: "done" }); // user pressed stop — silent
    } else {
      const message = err instanceof Error ? err.message : String(err);
      patch({ imagePending: false, status: "done", error: message });
      toast.error("Image generation failed", message);
    }
  } finally {
    set({ isStreaming: false, webSearchPhase: "idle" });
    if (currentAbort === controller) currentAbort = null;
  }
}

interface ChatState {
  conversations: Conversation[];
  activeId: string | null;
  isStreaming: boolean;
  webSearchPhase: WebSearchPhase;
  /** id of the assistant message currently being read aloud (real Cartesia TTS) */
  speakingMessageId: string | null;

  activeConversation: () => Conversation | null;

  newChat: () => void;
  selectConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  renameConversation: (id: string, title: string) => void;

  sendMessage: (content: string, opts?: { webSearch?: boolean; imageUrl?: string }) => void;
  /** Send the prompt to /api/image-gen and render the result inline. */
  generateImage: (prompt: string) => void;
  /** Re-fetch an image message with a new seed (retry + Regenerate button). */
  regenerateImage: (messageId: string) => void;
  stopStreaming: () => void;
  regenerate: () => void;
  editUserMessage: (messageId: string, newContent: string) => void;

  /** Append a completed voice-mode exchange without re-streaming it. */
  appendVoiceExchange: (
    userText: string,
    assistantText: string,
    meta?: { citations?: Citation[]; webSearched?: boolean }
  ) => void;

  toggleSpeak: (messageId: string, text: string) => void;
  stopSpeaking: () => void;
}

const titleFrom = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? clean.slice(0, 48) + "…" : clean || "New chat";
};

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      conversations: [],
      activeId: null,
      isStreaming: false,
      webSearchPhase: "idle",
      speakingMessageId: null,

      activeConversation: () => {
        const { conversations, activeId } = get();
        return conversations.find((c) => c.id === activeId) ?? null;
      },

      newChat: () => set({ activeId: null }),

      selectConversation: (id) => set({ activeId: id }),

      deleteConversation: (id) =>
        set((s) => {
          const conversations = s.conversations.filter((c) => c.id !== id);
          const activeId =
            s.activeId === id
              ? ([...conversations].sort((a, b) => b.updatedAt - a.updatedAt)[0]
                  ?.id ?? null)
              : s.activeId;
          return { conversations, activeId };
        }),

      renameConversation: (id, title) =>
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === id ? { ...c, title: title.trim() || c.title } : c
          ),
        })),

      sendMessage: (content, opts) => {
        const text = content.trim();
        const imageUrl = opts?.imageUrl;
        if ((!text && !imageUrl) || get().isStreaming) return;
        const webSearch = opts?.webSearch ?? false;

        const userMessage: Message = {
          id: uid(),
          role: "user",
          content: text,
          createdAt: Date.now(),
          status: "done",
          imageUrl,
        };

        let convId = get().activeId;
        const exists = convId && get().conversations.some((c) => c.id === convId);

        if (exists) {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [...c.messages, userMessage],
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }));
        } else {
          convId = uid();
          const conv: Conversation = {
            id: convId,
            title: titleFrom(text || "Image"),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [userMessage],
          };
          set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
        }

        void runAssistantReply(convId!, text, webSearch, set, get, imageUrl);
      },

      generateImage: (prompt) => {
        const text = prompt.trim();
        if (!text || get().isStreaming) return;

        const userMessage: Message = {
          id: uid(),
          role: "user",
          content: text,
          createdAt: Date.now(),
          status: "done",
        };
        const assistantId = uid();
        const assistantMessage: Message = {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: Date.now() + 1,
          status: "streaming",
          imagePrompt: text,
          imagePending: true,
        };

        let convId = get().activeId;
        const exists = convId && get().conversations.some((c) => c.id === convId);

        if (exists) {
          set((s) => ({
            conversations: s.conversations.map((c) =>
              c.id === convId
                ? {
                    ...c,
                    messages: [...c.messages, userMessage, assistantMessage],
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }));
        } else {
          convId = uid();
          const conv: Conversation = {
            id: convId,
            title: titleFrom(text),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [userMessage, assistantMessage],
          };
          set((s) => ({ conversations: [conv, ...s.conversations], activeId: conv.id }));
        }

        set({ isStreaming: true, webSearchPhase: "thinking" });
        void runImageGen(convId!, assistantId, text, set);
      },

      regenerateImage: (messageId) => {
        const s = get();
        if (s.isStreaming) return;
        const conv = s.activeConversation();
        const msg = conv?.messages.find((m) => m.id === messageId);
        if (!conv || !msg?.imagePrompt) return;

        set((st) => ({
          conversations: st.conversations.map((c) =>
            c.id === conv.id
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === messageId
                      ? { ...m, imagePending: true, error: undefined, imageUrl: undefined, status: "streaming" as const }
                      : m
                  ),
                }
              : c
          ),
          isStreaming: true,
          webSearchPhase: "thinking",
        }));
        void runImageGen(conv.id, messageId, msg.imagePrompt, set);
      },

      stopStreaming: () => {
        currentAbort?.abort();
        currentAbort = null;
        stopSpeakingAudio();
        set((s) => ({
          isStreaming: false,
          webSearchPhase: "idle",
          speakingMessageId: null,
          conversations: s.conversations.map((c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.status === "streaming"
                ? {
                    ...m,
                    status: "done" as const,
                    imagePending: false,
                    // Stopped mid-generation → surface a Retry instead of a blank hole
                    ...(m.imagePrompt && !m.imageUrl
                      ? { error: "Generation stopped before the image finished." }
                      : {}),
                  }
                : m
            ),
          })),
        }));
      },

      regenerate: () => {
        const s = get();
        if (s.isStreaming) return;
        const conv = s.activeConversation();
        if (!conv) return;
        const lastAssistantIdx = conv.messages.map((m) => m.role).lastIndexOf("assistant");
        if (lastAssistantIdx === -1) return;
        const lastAssistant = conv.messages[lastAssistantIdx];
        const userMessage = [...conv.messages.slice(0, lastAssistantIdx)]
          .reverse()
          .find((m) => m.role === "user");
        if (!userMessage) return;
        const webSearch = lastAssistant.webSearched ?? false;

        set((st) => ({
          conversations: st.conversations.map((c) =>
            c.id === conv.id
              ? { ...c, messages: c.messages.slice(0, lastAssistantIdx) }
              : c
          ),
        }));
        void runAssistantReply(conv.id, userMessage.content, webSearch, set, get, userMessage.imageUrl);
      },

      editUserMessage: (messageId, newContent) => {
        const s = get();
        if (s.isStreaming) return;
        const text = newContent.trim();
        if (!text) return;
        const conv = s.activeConversation();
        if (!conv) return;
        const idx = conv.messages.findIndex(
          (m) => m.id === messageId && m.role === "user"
        );
        if (idx === -1) return;

        set((st) => ({
          conversations: st.conversations.map((c) =>
            c.id === conv.id
              ? {
                  ...c,
                  updatedAt: Date.now(),
                  messages: [
                    ...c.messages.slice(0, idx),
                    { ...c.messages[idx], content: text },
                  ],
                }
              : c
          ),
        }));
        void runAssistantReply(
          conv.id,
          text,
          false,
          set,
          get,
          (conv.messages[idx] as Message).imageUrl
        );
      },

      appendVoiceExchange: (userText, assistantText, meta) => {
        const userMessage: Message = {
          id: uid(),
          role: "user",
          content: userText,
          createdAt: Date.now(),
          status: "done",
        };
        const assistantMessage: Message = {
          id: uid(),
          role: "assistant",
          content: assistantText,
          createdAt: Date.now() + 1,
          status: "done",
          webSearched: meta?.webSearched,
          citations: meta?.citations,
        };
        set((s) => {
          const convId =
            s.activeId && s.conversations.some((c) => c.id === s.activeId)
              ? s.activeId
              : null;
          if (convId) {
            return {
              conversations: s.conversations.map((c) =>
                c.id === convId
                  ? {
                      ...c,
                      messages: [...c.messages, userMessage, assistantMessage],
                      updatedAt: Date.now(),
                    }
                  : c
              ),
            };
          }
          const conv: Conversation = {
            id: uid(),
            title: titleFrom(userText),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: [userMessage, assistantMessage],
          };
          return { conversations: [conv, ...s.conversations], activeId: conv.id };
        });
      },

      toggleSpeak: (messageId, text) => {
        const s = get();
        if (s.speakingMessageId === messageId) {
          stopSpeakingAudio();
          speakingRequestId += 1; // invalidate the in-flight promise
          set({ speakingMessageId: null });
          return;
        }
        stopSpeakingAudio();
        const reqId = ++speakingRequestId;
        set({ speakingMessageId: messageId });
        // Keys come from env server-side, falling back to Settings in-memory keys
        void speakText(text).then((result) => {
          if (reqId !== speakingRequestId) return; // superseded or stopped
          set({ speakingMessageId: null });
          if (result.status === "error") {
            toast.error("Read-aloud failed", result.message);
          }
        });
      },

      stopSpeaking: () => {
        speakingRequestId += 1;
        stopSpeakingAudio();
        set({ speakingMessageId: null });
      },
    }),
    {
      name: "novachat-chat",
      storage: createJSONStorage(() => localStorage),
      skipHydration: true, // rehydrate manually after mount to avoid SSR mismatch
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId,
      }),
      merge: (persisted, current) => {
        const p = persisted as Partial<ChatState> | undefined;
        const conversations = (p?.conversations ?? current.conversations).map(
          (c) => ({
            ...c,
            messages: c.messages.map((m) =>
              m.status === "streaming" ? { ...m, status: "done" as const } : m
            ),
          })
        );
        return { ...current, conversations, activeId: p?.activeId ?? null };
      },
    }
  )
);
