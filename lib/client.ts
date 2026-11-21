"use client";

/**
 * Client transport for NovaChat's own API routes.
 * Components/stores never call Groq/Cartesia/SerpApi directly — everything
 * goes through /api/* with the user's in-memory keys as fallbacks.
 * Keys resolve server-side: process.env.* wins, these are the fallback.
 */

import { useSettingsStore } from "@/store/settings-store";

export interface ClientKeys {
  groqKey?: string;
  cartesiaKey?: string;
  serpapiKey?: string;
}

export const getClientKeys = (): ClientKeys => {
  const k = useSettingsStore.getState().apiKeys;
  return {
    groqKey: k.groq || undefined,
    cartesiaKey: k.cartesia || undefined,
    serpapiKey: k.serpapi || undefined,
  };
};

/* ------------------------------------------------------------------ */
/* Chat SSE                                                            */
/* ------------------------------------------------------------------ */

export interface ChatStreamHandlers {
  onPhase?: (value: "searching" | "thinking") => void;
  onMeta?: (meta: {
    webSearched?: boolean;
    citations?: import("@/lib/types").Citation[];
    warning?: string;
  }) => void;
  onDelta?: (content: string) => void;
  /** Fatal or mid-stream error, already normalized to a message. */
  onError?: (message: string) => void;
  onDone?: () => void;
}

export interface ChatRequest {
  messages: { role: "user" | "assistant"; content: string }[];
  webSearch?: boolean;
  model?: string;
}

export async function streamChat(
  request: ChatRequest,
  handlers: ChatStreamHandlers,
  signal?: AbortSignal
): Promise<void> {
  const keys = getClientKeys();
  let res: Response;
  try {
    res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...request, ...keys }),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) return; // user pressed stop — not an error
    handlers.onError?.(
      `Network error — couldn't reach NovaChat's API routes. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  if (!res.ok || !res.body) {
    let message = `Chat failed (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (j?.message) message = j.message;
    } catch {
      /* non-JSON error body */
    }
    handlers.onError?.(message);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") {
          handlers.onDone?.();
          return;
        }
        let evt: {
          type: string;
          value?: "searching" | "thinking";
          content?: string;
          message?: string;
          webSearched?: boolean;
          citations?: import("@/lib/types").Citation[];
          warning?: string;
        };
        try {
          evt = JSON.parse(data);
        } catch {
          continue; // keep-alive / malformed frame
        }
        switch (evt.type) {
          case "phase":
            if (evt.value) handlers.onPhase?.(evt.value);
            break;
          case "meta":
            handlers.onMeta?.(evt);
            break;
          case "delta":
            if (evt.content) handlers.onDelta?.(evt.content);
            break;
          case "error":
            handlers.onError?.(evt.message ?? "Unknown chat error.");
            break;
          case "done":
            break; // [DONE] line follows and triggers onDone
        }
      }
    }
    handlers.onDone?.();
  } catch (err) {
    if (signal?.aborted) return;
    handlers.onError?.(
      `Connection dropped mid-stream: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/* ------------------------------------------------------------------ */
/* TTS — one shared Audio element so barge-in can cut Nova off          */
/* ------------------------------------------------------------------ */

let currentAudio: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let currentSpeakResolver: ((r: SpeakResult) => void) | null = null;

function teardownAudio() {
  // Resolve the in-flight speakText promise so callers can settle their
  // state machines (barge-in, end-call, or superseded playback).
  if (currentSpeakResolver) {
    currentSpeakResolver({ status: "ended" });
    currentSpeakResolver = null;
  }
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.src = "";
    currentAudio = null;
  }
  if (currentUrl) {
    URL.revokeObjectURL(currentUrl);
    currentUrl = null;
  }
}

/** Stop any in-flight speech immediately (barge-in / user cancel). */
export function stopSpeakingAudio() {
  teardownAudio();
}

export interface SpeakResult {
  status: "ended" | "error";
  message?: string;
}

/**
 * Speak `text` with Cartesia TTS through /api/tts.
 * Resolves when playback ends or errors. Replaces any in-flight playback.
 */
export async function speakText(text: string, voiceId?: string): Promise<SpeakResult> {
  teardownAudio();
  const { cartesiaKey } = getClientKeys();
  const voice = voiceId ?? useSettingsStore.getState().voiceId;

  let res: Response;
  try {
    res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId: voice, cartesiaKey }),
    });
  } catch (err) {
    return {
      status: "error",
      message: `Couldn't reach the TTS route. ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (!res.ok) {
    let message = `TTS failed (HTTP ${res.status}).`;
    try {
      const j = await res.json();
      if (j?.message) message = j.message;
    } catch {
      /* non-JSON */
    }
    return { status: "error", message };
  }

  const blob = await res.blob();
  currentUrl = URL.createObjectURL(blob);
  const audio = new Audio(currentUrl);
  currentAudio = audio;

  return new Promise<SpeakResult>((resolve) => {
    currentSpeakResolver = resolve;
    audio.onended = () => {
      const r = currentSpeakResolver;
      teardownAudio();
      r?.({ status: "ended" });
    };
    audio.onerror = () => {
      const r = currentSpeakResolver;
      teardownAudio();
      r?.({ status: "error", message: "Audio playback failed." });
    };
    audio.play().catch((err) => {
      const r = currentSpeakResolver;
      teardownAudio();
      r?.({
        status: "error",
        message: `Playback blocked: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* STT                                                                 */
/* ------------------------------------------------------------------ */

/**
 * Transcribe a recorded audio blob via /api/stt (Cartesia ink-whisper).
 * Throws an Error carrying `status` and the raw upstream body on failure,
 * so callers can log Cartesia's actual reason, not just a generic message.
 */
export interface TranscribeError extends Error {
  status?: number;
  body?: string;
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const { cartesiaKey } = getClientKeys();
  const form = new FormData();
  // Detect the actual container from the blob's MIME type so Cartesia
  // decodes the right format (webm vs mp4 vs wav vs ogg).
  const mime = (blob.type || "").toLowerCase();
  const ext =
    mime.includes("mp4") || mime.includes("m4a")
      ? "mp4"
      : mime.includes("ogg") || mime.includes("oga")
        ? "ogg"
        : mime.includes("wav")
          ? "wav"
          : mime.includes("mp3") || mime.includes("mpeg")
            ? "mp3"
            : "webm";
  if (!mime) {
    console.warn("[voice] STT: blob.type is empty — defaulting to webm; may fail on non-Chrome browsers");
  }
  form.append("file", blob, `recording.${ext}`);
  if (cartesiaKey) form.append("cartesiaKey", cartesiaKey);

  console.info(`[voice] STT payload → blob.size=${blob.size}B type=${blob.type || "unknown"} filename=recording.${ext}`);

  let res: Response;
  try {
    res = await fetch("/api/stt", { method: "POST", body: form });
  } catch (err) {
    const e: TranscribeError = new Error(
      `Couldn't reach the STT route. ${err instanceof Error ? err.message : String(err)}`
    );
    e.status = 0;
    throw e;
  }

  const rawBody = await res.text();
  if (!res.ok) {
    console.error(`[voice] STT raw response (HTTP ${res.status}):`, rawBody);
    let message = `Transcription failed (HTTP ${res.status}).`;
    try {
      const j = JSON.parse(rawBody);
      if (j?.message) message = j.message;
    } catch {
      /* non-JSON */
    }
    const e: TranscribeError = new Error(message);
    e.status = res.status;
    e.body = rawBody;
    throw e;
  }
  try {
    const j = JSON.parse(rawBody) as { text?: string };
    return (j.text ?? "").trim();
  } catch {
    console.error("[voice] STT raw response (unparseable JSON):", rawBody);
    const e: TranscribeError = new Error("STT returned an unparseable response.");
    e.status = res.status;
    e.body = rawBody;
    throw e;
  }
}
