"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  AudioWaveform,
  Brain,
  FileText,
  Globe,
  Loader2,
  Mic,
  MicOff,
  Plus,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStore } from "@/store/chat-store";
import { useSettingsStore } from "@/store/settings-store";
import { useVoiceStore } from "@/store/voice-store";
import { transcribeAudio } from "@/lib/client";
import { toast } from "@/store/toast-store";

interface Attachment {
  id: string;
  name: string;
  sizeKb: number;
}

/**
 * Composer: autogrowing textarea (Enter = send, Shift+Enter = newline),
 * mic button with real Cartesia STT + animated waveform, attachment stub (adds a
 * removable file chip; real upload is Phase 2), and a per-message
 * "Search the web" pill.
 *
 * variant="home" renders it inline (no sticky bottom bar) as a wide pill
 * under the welcome heading: Think toggle, mic, and a circular accent voice
 * button that shows while the field is empty (send replaces it once there's
 * text).
 */
export function InputBar({ variant = "chat" }: { variant?: "chat" | "home" }) {
  const isHome = variant === "home";
  const [value, setValue] = useState("");
  const [think, setThink] = useState(false);
  const [webSearch, setWebSearch] = useState(
    () => useSettingsStore.getState().searchByDefault
  );
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const sendMessage = useChatStore((s) => s.sendMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const searchByDefault = useSettingsStore((s) => s.searchByDefault);
  const openVoice = useVoiceStore((s) => s.openVoice);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep the pill in sync if the user changes the default in settings
  useEffect(() => setWebSearch(searchByDefault), [searchByDefault]);

  // Autogrow
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 220) + "px";
  }, [value]);

  const canSend = (value.trim().length > 0 || attachments.length > 0) && !isStreaming;

  const submit = () => {
    if (!canSend) return;
    sendMessage(value, { webSearch });
    setValue("");
    setAttachments([]);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const toggleMic = async () => {
    if (transcribing) return;
    if (recording) {
      recorder.current?.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      const rec = new MediaRecorder(stream);
      chunks.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setTranscribing(true);
        const blob = new Blob(chunks.current, { type: rec.mimeType || "audio/webm" });
        try {
          const text = await transcribeAudio(blob);
          setValue((v) => (v.trim() ? v.trimEnd() + " " + text : text));
        } catch (err) {
          toast.error(
            "Transcription failed",
            err instanceof Error ? err.message : String(err)
          );
        } finally {
          setTranscribing(false);
        }
      };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      toast.error(
        "Microphone unavailable",
        denied
          ? "Permission denied — allow mic access for this site and try again."
          : err instanceof Error
            ? err.message
            : String(err)
      );
    }
  };

  // Attachment stub: files are UI-only chips, never uploaded (Groq Files API could wire this later)
  const addMockAttachment = () => {
    const samples = ["launch-brief.pdf", "q3-metrics.xlsx", "diagram.png"];
    const name = samples[Math.floor(Math.random() * samples.length)];
    setAttachments((a) => [
      ...a,
      { id: Math.random().toString(36).slice(2), name, sizeKb: 40 + Math.floor(Math.random() * 900) },
    ]);
  };

  return (
    <div
      className={
        isHome
          ? "pointer-events-auto relative"
          : "pointer-events-none sticky bottom-0 z-10 px-3 pb-3 pt-2 sm:px-6 sm:pb-5"
      }
    >
      {!isHome && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-background via-background/85 to-transparent"
        />
      )}
      <div
        className={cn(
          "pointer-events-auto relative",
          !isHome && "mx-auto max-w-3xl"
        )}
      >
        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-2 rounded-xl border border-border bg-card py-1.5 pl-2.5 pr-1.5 text-xs text-foreground shadow-lift"
              >
                <FileText size={13} className="text-accent" />
                <span className="max-w-[160px] truncate">{a.name}</span>
                <span className="text-muted-foreground">{a.sizeKb} KB</span>
                <button
                  onClick={() => setAttachments((s) => s.filter((f) => f.id !== a.id))}
                  className="rounded-md p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={`Remove ${a.name}`}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Transcribing row (STT round-trip in flight) */}
        {transcribing && (
          <div
            className="mb-2 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lift"
            role="status"
            aria-live="polite"
          >
            <Loader2 size={16} className="animate-spin text-accent" />
            <span className="text-xs font-medium text-muted-foreground">
              Transcribing…
            </span>
          </div>
        )}

        {/* Recording waveform row */}
        {recording && (
          <div
            className="mb-2 flex items-center gap-3 rounded-2xl border border-accent/40 bg-card px-4 py-2.5 shadow-soft"
            role="status"
            aria-live="polite"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
            </span>
            <span className="text-xs font-medium text-accent">Listening…</span>
            <div className="flex h-6 flex-1 items-center gap-[3px]" aria-hidden>
              {Array.from({ length: 42 }).map((_, i) => (
                <span
                  key={i}
                  className="w-[3px] origin-center animate-eq rounded-full bg-accent/80"
                  style={{
                    height: `${30 + ((i * 37) % 70)}%`,
                    animationDelay: `${(i % 9) * 0.09}s`,
                    animationDuration: `${0.6 + ((i * 13) % 5) * 0.13}s`,
                  }}
                />
              ))}
            </div>
            <button
              onClick={toggleMic}
              className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Stop recording and insert text"
            >
              <MicOff size={16} />
            </button>
          </div>
        )}

        {/* Composer */}
        <div
          className={cn(
            isHome
              ? "rounded-[28px] border border-border bg-card shadow-soft transition-shadow focus-within:border-accent/40 focus-within:shadow-[0_8px_40px_-12px_var(--ring)]"
              : "rounded-3xl border border-border bg-card shadow-soft transition-shadow focus-within:shadow-[0_8px_40px_-12px_var(--ring)] focus-within:border-accent/40",
            recording && "opacity-70"
          )}
        >
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            placeholder={isHome ? "Ask NovaChat" : "Message NovaChat…"}
            aria-label={isHome ? "Ask NovaChat" : "Message NovaChat"}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
            className="block max-h-[220px] w-full resize-none bg-transparent px-5 pt-4 text-[15px] leading-6 outline-none placeholder:text-muted-foreground"
          />
          <div className="flex items-center gap-1.5 px-3 pb-3 pt-1">
            {/* Attachment (stub) — Plus on the far left, like ChatGPT */}
            <button
              onClick={addMockAttachment}
              className="rounded-full p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title="Attach file (demo)"
              aria-label="Attach file"
            >
              <Plus size={19} strokeWidth={2} />
            </button>

            {/* Web search per-message pill */}
            <button
              onClick={() => setWebSearch((v) => !v)}
              role="switch"
              aria-checked={webSearch}
              title="Ground this reply with Google Search"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                webSearch
                  ? "border-accent/50 bg-accent/15 text-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                  : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
              )}
            >
              <Globe size={13} />
              <span className="hidden sm:inline">Search</span>
            </button>

            {/* Think toggle — visual-only reasoning mode for now */}
            {isHome && (
              <button
                onClick={() => setThink((v) => !v)}
                role="switch"
                aria-checked={think}
                title="Reasoning mode (visual only for now)"
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all duration-150",
                  think
                    ? "border-accent/50 bg-accent/15 text-accent shadow-[inset_0_0_0_1px_var(--accent)]"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/40"
                )}
              >
                <Brain size={13} />
                <span>Think</span>
              </button>
            )}

            <div className="flex-1" />

            {/* Mic / STT */}
            <button
              onClick={toggleMic}
              aria-pressed={recording}
              className={cn(
                "rounded-full p-2 transition-colors",
                recording
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
                transcribing && "opacity-50"
              )}
              title={recording ? "Stop dictation" : "Dictate"}
              aria-label={recording ? "Stop dictation" : "Start dictation"}
            >
              {recording ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {/* Home + empty field → circular accent voice button; otherwise send */}
            {isHome && value.trim() === "" && attachments.length === 0 ? (
              <button
                onClick={openVoice}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-accent-foreground transition-all duration-150 hover:bg-accent-hover"
                aria-label="Start voice conversation"
                title="Voice mode"
              >
                <AudioWaveform size={17} strokeWidth={2} />
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={!canSend}
                aria-label="Send message"
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-full transition-all duration-150",
                  canSend
                    ? "bg-accent text-accent-foreground hover:bg-accent-hover"
                    : "bg-muted text-muted-foreground/60"
                )}
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
        {!isHome && (
          <p className="mt-2 text-center text-[10px] text-muted-foreground/70">
            NovaChat can make mistakes — check important answers.
          </p>
        )}
      </div>
    </div>
  );
}
