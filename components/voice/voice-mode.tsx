"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Keyboard, Mic, MicOff, PhoneOff, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { uid } from "@/lib/id";
import { useVoiceStore } from "@/store/voice-store";
import { useSettingsStore } from "@/store/settings-store";
import { useChatStore } from "@/store/chat-store";
import { GROQ_MODELS } from "@/lib/data";
import {
  speakText,
  stopSpeakingAudio,
  streamChat,
  transcribeAudio,
} from "@/lib/client";
import { toast } from "@/store/toast-store";
import type { Citation } from "@/lib/types";

/**
 * Full-screen voice-to-voice takeover — real pipeline (Phase 2):
 *   mic → MediaRecorder → /api/stt (Cartesia) → /api/chat (Groq SSE)
 *   → /api/tts (Cartesia) → playback → auto-resume listening.
 * Barge-in: while Nova is speaking, the mic VAD keeps running; sustained
 * user speech cuts the TTS playback and starts a new utterance.
 * Endpointing: listening stops after ~1.4s of silence following detected speech.
 */
export function VoiceMode() {
  const open = useVoiceStore((s) => s.open);
  const status = useVoiceStore((s) => s.status);
  const muted = useVoiceStore((s) => s.muted);
  const captions = useVoiceStore((s) => s.captions);
  const toggleMute = useVoiceStore((s) => s.toggleMute);
  const closeVoice = useVoiceStore((s) => s.closeVoice);
  const model = useSettingsStore((s) => s.model);

  const captionsRef = useRef<HTMLDivElement>(null);

  // ---- session machinery (refs, not state — no re-renders for timers) ----
  const sessionRef = useRef(0);
  const micStreamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const vadTimerRef = useRef<number | null>(null);
  const logTimerRef = useRef<number | null>(null);
  const safetyTimerRef = useRef<number | null>(null);
  const heardVoiceRef = useRef(false);
  const speechMsRef = useRef(0);
  const silenceMsRef = useRef(0);
  const bargeInMsRef = useRef(0);
  const maxLevelRef = useRef(0);
  const floorRef = useRef(0.02); // rolling ambient noise estimate
  const speechThresholdRef = useRef(0.05); // derived from floor; logged live
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  // Phase B — sentence-chunked TTS queue
  const ttsQueueRef = useRef<string[]>([]);
  const ttsBusyRef = useRef(false);
  const ttsBufferRef = useRef("");
  const llmFirstTokenRef = useRef(false);
  const ttsFirstAudioRef = useRef(false);

  const clearVad = () => {
    if (vadTimerRef.current !== null) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (logTimerRef.current !== null) {
      window.clearInterval(logTimerRef.current);
      logTimerRef.current = null;
    }
  };

  const rmsLevel = (): number => {
    const analyser = analyserRef.current;
    if (!analyser) return 0;
    const buf = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) {
      const d = (buf[i] - 128) / 128;
      sum += d * d;
    }
    return Math.sqrt(sum / buf.length);
  };

  /* ------------------------------------------------------------ */
  /* Session lifecycle                                             */
  /* ------------------------------------------------------------ */

  useEffect(() => {
    if (!open) return;
    const session = ++sessionRef.current;

    const streamCaptionWords = async (
      captionId: string,
      text: string,
      s: number
    ) => {
      const words = text.split(" ");
      const step = Math.max(1, Math.ceil(words.length / 24)); // ≤ ~1s regardless of length
      for (let i = step; i <= Math.ceil(words.length / step) * step; i += step) {
        if (sessionRef.current !== s) return;
        useVoiceStore
          .getState()
          .appendCaption(captionId, words.slice(0, i).join(" "));
        await new Promise((r) => window.setTimeout(r, 40));
      }
      useVoiceStore.getState().finishCaption(captionId, text);
    };

    const beginListening = async () => {
      if (sessionRef.current !== session) return;
      heardVoiceRef.current = false;
      speechMsRef.current = 0;
      silenceMsRef.current = 0;
      bargeInMsRef.current = 0;
      maxLevelRef.current = 0;
      chunksRef.current = [];
      useVoiceStore.getState().setStatus("listening");

      let stream = micStreamRef.current;
      if (!stream || stream.getTracks().every((t) => t.readyState === "ended")) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          });
        } catch (err) {
          if (sessionRef.current !== session) return;
          const denied =
            err instanceof DOMException && err.name === "NotAllowedError";
          toast.error(
            "Microphone unavailable",
            denied
              ? "Permission denied. Allow the mic for this site and reopen voice mode."
              : err instanceof Error
                ? err.message
                : String(err)
          );
          useVoiceStore.getState().closeVoice();
          return;
        }
        if (sessionRef.current !== session) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        micStreamRef.current = stream;
        const track = stream.getAudioTracks()[0];
        console.info("[voice] mic track:", {
          readyState: track?.readyState,
          muted: track?.muted,
          label: track?.label,
        });

        // OS-level mute detection — this is the #1 cause of "no speech detected"
        if (track?.muted) {
          console.error(
            "[voice] mic track is MUTED at the OS level. " +
              "Check: Windows Settings → Privacy → Microphone → Allow apps to access microphone. " +
              "Also check for a hardware mute button on your laptop/headset."
          );
          toast.error(
            "Microphone is muted",
            "Windows is blocking audio from this mic. Check Privacy → Microphone settings, or try a different input device."
          );
        }

        // React to OS mute/unmute changes while listening
        if (track) {
          track.onmute = () => {
            console.warn("[voice] mic track became MUTED (OS-level)");
            toast.warn("Microphone muted", "Windows muted the mic. Check your input device.");
          };
          track.onunmute = () => {
            console.info("[voice] mic track UNMUTED — audio flowing again");
          };
        }

        const ctx = new AudioContext();
        // Chrome starts AudioContext suspended until a user gesture —
        // resume explicitly or the analyser reads zeros forever
        void ctx.resume().then(() =>
          console.info(`[voice] AudioContext state: ${ctx.state}`)
        );
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0.55;
        ctx.createMediaStreamSource(stream).connect(analyser);
        audioCtxRef.current = ctx;
        analyserRef.current = analyser;
      }

      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        void endUtterance();
      };
      recorderRef.current = rec;
      rec.start(); // no timeslice — produces a complete webm on stop
      // Safety net: never hang recording forever
      if (safetyTimerRef.current !== null) window.clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = window.setTimeout(() => {
        if (sessionRef.current !== session) return;
        if (recorderRef.current?.state === "recording") {
          console.warn("[voice] max recording duration (25s) reached → stopping");
          recorderRef.current.stop();
        }
      }, 25000);
    };

    // Barge-in: Nova stops, we start a fresh utterance under the same session.
    // The VAD interval is session-scoped, so it stays alive across transitions.
    const bargeIn = () => {
      ttsQueueRef.current = [];
      ttsBufferRef.current = "";
      ttsBusyRef.current = false;
      stopSpeakingAudio(); // cut Nova off mid-sentence (resolves its speakText too)
      bargeInMsRef.current = 0;
      void beginListening();
    };

    // VAD loop — endpointing in listening, barge-in detection in speaking.
    // Threshold adapts to the ambient noise floor instead of a fixed number.
    clearVad();
    vadTimerRef.current = window.setInterval(() => {
      if (sessionRef.current !== session) return;
      const st = useVoiceStore.getState().status;
      if (st !== "listening" && st !== "speaking") return;
      const level = rmsLevel();
      maxLevelRef.current = Math.max(maxLevelRef.current, level);

      // If the track is OS-muted, the analyser reads zeros — warn once
      const track = micStreamRef.current?.getAudioTracks()[0];
      if (track?.muted && st === "listening") {
        // Don't spam — only log once per muted period
        if (!heardVoiceRef.current) {
          console.warn("[voice] VAD: track.muted=true — mic is not producing audio at the OS level");
        }
        return; // skip endpointing while muted
      }

      // If no audio detected for 3+ seconds, warn the user
      if (st === "listening" && !heardVoiceRef.current && maxLevelRef.current === 0) {
        // Only warn once per listening session
        if (silenceMsRef.current === 2700) {
          console.warn("[voice] No audio detected after 3s — mic may be muted or wrong device selected");
          toast.warn("No audio detected", "Speak louder or check your mic input device in Windows settings.");
        }
      }

      // Rolling ambient-floor estimate → speech threshold above it
      if (level < speechThresholdRef.current) {
        floorRef.current = floorRef.current * 0.96 + level * 0.04;
        speechThresholdRef.current = Math.min(
          0.12,
          Math.max(0.03, floorRef.current * 2.5 + 0.015)
        );
      }
      const threshold = speechThresholdRef.current;
      const speech = level > threshold;

      if (st === "listening") {
        if (speech) {
          heardVoiceRef.current = true;
          speechMsRef.current += 90;
          silenceMsRef.current = 0;
        } else if (heardVoiceRef.current) {
          silenceMsRef.current += 90;
          // End after ~1s of silence once ANY real speech was heard.
          // (Earlier 350ms min-speech gate was too strict for short
          //  utterances like "hello" — recording never stopped.)
          if (silenceMsRef.current >= 1000) {
            console.info(
              `[voice] endpoint: ${speechMsRef.current}ms speech, ${silenceMsRef.current}ms silence → stopping recorder`
            );
            heardVoiceRef.current = false;
            if (recorderRef.current?.state === "recording") {
              recorderRef.current.stop();
            }
          }
        }
      } else {
        // speaking — barge-in needs a higher bar than Nova's speaker echo
        const bargeThreshold = Math.max(0.045, threshold * 1.5);
        if (level > bargeThreshold) {
          bargeInMsRef.current += 90;
          if (bargeInMsRef.current >= 270) {
            console.info("[voice] barge-in: user speech during playback → Nova stops");
            bargeIn();
          }
        } else {
          bargeInMsRef.current = 0;
        }
      }
    }, 90);

    // 200ms live audio meter — see what the mic actually hears
    window.clearInterval(logTimerRef.current ?? undefined);
    logTimerRef.current = window.setInterval(() => {
      if (sessionRef.current !== session) return;
      const st = useVoiceStore.getState().status;
      if (st !== "listening" && st !== "speaking") return;
      console.info(
        `[voice] level=${rmsLevel().toFixed(4)} floor=${floorRef.current.toFixed(4)} ` +
          `threshold=${speechThresholdRef.current.toFixed(4)} status=${st} maxLevel=${maxLevelRef.current.toFixed(4)}`
      );
    }, 200);

    // Split streamed text into speakable sentences, stripping markdown noise.
    const SENTENCE_BOUNDARY = /[.!?…]+(\s+|$)/;
    const extractSentences = (buf: string): [string[], string] => {
      const out: string[] = [];
      let rest = buf;
      for (;;) {
        const m = SENTENCE_BOUNDARY.exec(rest);
        if (!m) break;
        const end = m.index + m[0].length;
        const sentence = rest
          .slice(0, end)
          .replace(/[*_`#>~|]/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim();
        rest = rest.slice(end);
        if (sentence.length > 2) out.push(sentence);
      }
      return [out, rest];
    };

    // Speak completed sentences while the LLM is still streaming.
    const pumpTts = () => {
      if (ttsBusyRef.current) return;
      const next = ttsQueueRef.current.shift();
      if (!next) return;
      ttsBusyRef.current = true;
      if (ttsFirstAudioRef.current === false) {
        ttsFirstAudioRef.current = true;
        console.timeEnd("[voice] first LLM token → first TTS request");
        console.timeEnd("[voice] mic-stop → TTS first sentence");
      }
      if (useVoiceStore.getState().status !== "speaking") {
        useVoiceStore.getState().setStatus("speaking");
      }
      console.time("[voice] TTS sentence");
      void speakText(next).then((result) => {
        console.timeEnd("[voice] TTS sentence");
        ttsBusyRef.current = false;
        if (sessionRef.current !== session) return;
        if (result.status === "error") {
          toast.error("Read-aloud failed", result.message);
        }
        pumpTts();
      });
    };
    const enqueueTts = (sentence: string) => {
      ttsQueueRef.current.push(sentence);
      pumpTts();
    };

    const endUtterance = async () => {
      if (sessionRef.current !== session) return;
      if (safetyTimerRef.current !== null) { window.clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
      console.time("[voice] mic-stop → TTS first sentence");
      const blob = new Blob(chunksRef.current, {
        type: recorderRef.current?.mimeType || "audio/webm",
      });
      chunksRef.current = [];

      // Never upload silence — that's the "no speech detected" error path
      if (maxLevelRef.current < speechThresholdRef.current || blob.size < 1500) {
        console.warn(
          `[voice] skipping STT — maxLevel=${maxLevelRef.current.toFixed(4)} threshold=${speechThresholdRef.current.toFixed(4)} blobBytes=${blob.size}`
        );
        toast.warn("No speech heard", "I didn't catch anything — try speaking a bit louder.");
        void beginListening();
        return;
      }

      const vs = useVoiceStore.getState();
      vs.setStatus("transcribing");

      let userText = "";
      console.time("[voice] mic-stop → STT response");
      try {
        userText = await transcribeAudio(blob);
      } catch (err) {
        console.timeEnd("[voice] mic-stop → STT response");
        if (sessionRef.current !== session) return;
        console.error(
          "[voice] STT failed:",
          err instanceof Error ? err.message : String(err)
        );
        toast.error(
          "Transcription failed",
          err instanceof Error ? err.message : String(err)
        );
        void beginListening();
        return;
      }
      console.timeEnd("[voice] mic-stop → STT response");
      if (sessionRef.current !== session) return;
      userText = userText.trim();
      console.info(`[voice] STT transcript: ${JSON.stringify(userText)}`);
      if (!userText) {
        void beginListening();
        return;
      }

      // User caption
      const userCapId = uid();
      useVoiceStore.getState().startCaption(userCapId, "user");
      void streamCaptionWords(userCapId, userText, session);

      // Think: Groq, grounded if the user's search default is on
      useVoiceStore.getState().setStatus("thinking");
      const { searchByDefault, model: activeModel } = useSettingsStore.getState();
      const conv = useChatStore.getState().activeConversation();
      const history = (conv?.messages ?? [])
        .filter((m) => m.content.trim())
        .slice(-24)
        .map((m) => ({ role: m.role, content: m.content }))
        .concat({ role: "user", content: userText });

      const assistantCapId = uid();
      useVoiceStore.getState().startCaption(assistantCapId, "assistant");
      let acc = "";
      let meta: { citations?: Citation[]; webSearched?: boolean } | undefined;
      ttsBufferRef.current = "";
      ttsQueueRef.current = [];
      ttsBusyRef.current = false;
      llmFirstTokenRef.current = false;
      ttsFirstAudioRef.current = false;
      console.time("[voice] STT → first LLM token");
      console.time("[voice] first LLM token → first TTS request");

      await streamChat(
        { messages: history, webSearch: searchByDefault, model: activeModel },
        {
          onDelta: (delta) => {
            acc += delta;
            if (!llmFirstTokenRef.current) {
              llmFirstTokenRef.current = true;
              console.timeEnd("[voice] STT → first LLM token");
            }
            useVoiceStore.getState().appendCaption(assistantCapId, acc);
            // Sentence-chunked TTS — start speaking while the model is still streaming
            ttsBufferRef.current += delta;
            const [sentences, rest] = extractSentences(ttsBufferRef.current);
            if (sentences.length) {
              ttsBufferRef.current = rest;
              for (const s of sentences) enqueueTts(s);
            }
          },
          onMeta: (m) => {
            meta = { citations: m.citations, webSearched: m.webSearched };
            if (m.warning) toast.warn("Web search skipped", m.warning);
          },
          onError: (message) => {
            toast.error("NovaChat hit a snag", message);
            if (!acc) acc = "Sorry — I ran into an error answering that.";
          },
        }
      );
      if (sessionRef.current !== session) return;
      const finalText = acc.trim();
      useVoiceStore.getState().finishCaption(assistantCapId, finalText);
      if (ttsBufferRef.current.trim()) {
        const [, rest] = extractSentences(ttsBufferRef.current);
        const tail = (rest || ttsBufferRef.current).replace(/[*_`#>~|]/g, " ").trim();
        if (tail.length > 2) enqueueTts(tail);
        ttsBufferRef.current = "";
      }
      // Wait for the TTS queue to drain so the auto-resume doesn't talk over Nova
      await new Promise<void>((resolve) => {
        const check = () => {
          if (sessionRef.current !== session) return resolve();
          if (!ttsBusyRef.current && ttsQueueRef.current.length === 0) return resolve();
          window.setTimeout(check, 150);
        };
        check();
      });
      if (sessionRef.current !== session) return;

      if (finalText) {
        useChatStore.getState().appendVoiceExchange(userText, finalText, meta);
      }

      if (sessionRef.current !== session) return;
      if (!mutedRef.current) void beginListening();
    };

    void beginListening();

    return () => {
      // Leaving voice mode — tear down everything
      sessionRef.current += 1;
      clearVad();
      stopSpeakingAudio();
      if (safetyTimerRef.current !== null) { window.clearTimeout(safetyTimerRef.current); safetyTimerRef.current = null; }
      try {
        if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      } catch {
        /* already stopped */
      }
      recorderRef.current = null;
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
      void audioCtxRef.current?.close().catch(() => undefined);
      audioCtxRef.current = null;
      analyserRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Mute: silence mic tracks so VAD reads zeros; Nova's TTS is unaffected
  useEffect(() => {
    micStreamRef.current?.getAudioTracks().forEach((t) => {
      t.enabled = !muted;
    });
  }, [muted]);

  // Auto-scroll captions
  useEffect(() => {
    const el = captionsRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [captions]);

  const modelLabel = GROQ_MODELS.find((m) => m.id === model)?.label ?? model;

  const switchToText = () => {
    closeVoice();
    // Return focus to the composer so the keyboard comes up naturally
    window.setTimeout(() => {
      document
        .querySelector<HTMLTextAreaElement>('textarea[aria-label="Message NovaChat"]')
        ?.focus();
    }, 140);
  };

  const statusLabel = muted
    ? "Microphone muted"
    : status === "listening"
      ? "Listening…"
      : status === "transcribing"
        ? "Transcribing…"
        : status === "thinking"
          ? "Nova is thinking…"
          : "Nova is speaking…";

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="voice-takeover"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.35 } }}
          className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-[#0d0b0a] text-[#ece7df]"
          role="dialog"
          aria-modal="true"
          aria-label="Nova voice conversation"
        >
          {/* Ambient backdrop: warm radial glows, not a gradient cliché */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 70% 55% at 50% 42%, rgba(224,138,84,0.16), transparent 65%)," +
                "radial-gradient(ellipse 55% 45% at 50% 110%, rgba(224,138,84,0.10), transparent 60%)",
            }}
          />

          {/* Top bar */}
          <div className="relative flex items-center justify-between px-5 pt-5 sm:px-8">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e08a54] text-[#26130a]">
                <Sparkles size={16} />
              </span>
              <div className="leading-tight">
                <div className="text-sm font-semibold tracking-tight">Nova Voice</div>
                <div className="text-[10px] uppercase tracking-[0.16em] text-white/40">
                  {modelLabel} · Cartesia live
                </div>
              </div>
            </div>
            <div
              className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-white/60"
              aria-live="polite"
            >
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  status === "listening" && "bg-emerald-400 animate-pulse",
                  status === "transcribing" && "bg-sky-400 animate-pulse",
                  status === "thinking" && "bg-amber-400 animate-pulse",
                  status === "speaking" && "bg-[#e08a54] animate-pulse"
                )}
              />
              {status === "listening" && "Live"}
              {status === "transcribing" && "Transcribing"}
              {status === "thinking" && "Processing"}
              {status === "speaking" && "Speaking"}
            </div>
          </div>

          {/* Orb */}
          <div className="relative flex flex-1 flex-col items-center justify-center px-6">
            <button
              type="button"
              onClick={() => {
                if (status === "listening" && recorderRef.current?.state === "recording") {
                  console.info("[voice] manual stop (tap on orb)");
                  recorderRef.current.stop();
                }
              }}
              className={cn(
                "relative flex items-center justify-center",
                status === "listening" ? "cursor-pointer" : "cursor-default"
              )}
              aria-label={status === "listening" ? "Stop recording and transcribe" : undefined}
            >
              <Orb status={status} muted={muted} />
            </button>
            <div className="mt-8 h-6 text-center" aria-live="polite">
              <AnimatePresence mode="wait">
                <motion.p
                  key={status + (muted ? "-muted" : "")}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25 }}
                  className="text-sm font-medium tracking-wide text-white/70"
                >
                  {statusLabel}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Live captions */}
          <div
            ref={captionsRef}
            className="relative mx-auto w-full max-w-2xl overflow-y-auto px-6 pb-4 [max-height:26vh]"
            aria-live="polite"
            aria-label="Live transcript"
          >
            <div className="flex flex-col gap-2">
              {captions.slice(-6).map((c) => (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2 text-[13.5px] leading-snug",
                    c.speaker === "user"
                      ? "self-end rounded-br-md bg-white/10 text-white/85"
                      : "self-start rounded-bl-md border border-[#e08a54]/25 bg-[#e08a54]/10 text-[#f3d9c6]"
                  )}
                >
                  <span className="mb-0.5 block text-[9px] font-semibold uppercase tracking-[0.14em] opacity-50">
                    {c.speaker === "user" ? "You" : "Nova"}
                  </span>
                  {c.text}
                  {!c.done && <span className="ml-1 inline-block h-3 w-1.5 animate-pulse bg-current opacity-60" />}
                </motion.div>
              ))}
            </div>
          </div>

          {/* Controls */}
          <div className="relative flex items-center justify-center gap-5 pb-8 pt-2">
            <button
              onClick={toggleMute}
              aria-pressed={muted}
              aria-label={muted ? "Unmute microphone" : "Mute microphone"}
              title={muted ? "Unmute" : "Mute"}
              className={cn(
                "flex h-14 w-14 items-center justify-center rounded-full border transition-all duration-150",
                muted
                  ? "border-white/30 bg-white text-[#0d0b0a]"
                  : "border-white/15 bg-white/10 text-white/85 hover:bg-white/15"
              )}
            >
              {muted ? <MicOff size={22} /> : <Mic size={22} />}
            </button>

            <button
              onClick={closeVoice}
              aria-label="End voice conversation"
              title="End voice conversation"
              className="flex h-[72px] w-[72px] items-center justify-center rounded-full bg-[#e5484d] text-white shadow-[0_10px_40px_-8px_rgba(229,72,77,0.55)] transition-transform duration-150 hover:scale-105 active:scale-95"
            >
              <PhoneOff size={28} fill="currentColor" strokeWidth={1.5} />
            </button>

            <button
              onClick={switchToText}
              aria-label="Switch to text chat"
              title="Switch to text"
              className="flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-white/10 text-white/85 transition-colors hover:bg-white/15"
            >
              <Keyboard size={22} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* The orb — distinct physical states                                   */
/* ------------------------------------------------------------------ */

function Orb({
  status,
  muted,
}: {
  status: "listening" | "transcribing" | "thinking" | "speaking";
  muted: boolean;
}) {
  const listening = status === "listening";
  const speaking = status === "speaking";
  const processing = status === "thinking" || status === "transcribing";

  return (
    <div className="relative flex h-48 w-48 items-center justify-center sm:h-56 sm:w-56">
      {/* Outer halo */}
      <motion.div
        aria-hidden
        className="absolute inset-[-45%] rounded-full"
        style={{
          background: speaking
            ? "radial-gradient(circle, rgba(244,214,168,0.22) 0%, transparent 68%)"
            : "radial-gradient(circle, rgba(224,138,84,0.25) 0%, transparent 68%)",
        }}
        animate={{ scale: speaking ? [1, 1.18, 1] : listening ? [1, 1.08, 1.02, 1.12, 1] : [1, 1.03, 1] }}
        transition={
          speaking
            ? { duration: 2.6, repeat: Infinity, ease: "easeInOut" }
            : { duration: 1.5, repeat: Infinity, ease: "easeInOut" }
        }
      />

      {/* Orbit ring (processing states) */}
      {processing && (
        <motion.div
          aria-hidden
          className="absolute inset-[6%] rounded-full border border-transparent"
          style={{
            borderTopColor: "rgba(224,138,84,0.9)",
            borderRightColor: "rgba(224,138,84,0.25)",
          }}
          animate={{ rotate: 360 }}
          transition={{
            duration: status === "transcribing" ? 0.9 : 1.4,
            repeat: Infinity,
            ease: "linear",
          }}
        />
      )}

      {/* Core blob */}
      <motion.div
        aria-hidden
        className="relative h-full w-full overflow-hidden rounded-full"
        style={{
          background: speaking
            ? "radial-gradient(circle at 38% 35%, #f7e3c3 0%, #e9b980 38%, #c98a4e 72%, #8a5433 100%)"
            : listening
              ? "radial-gradient(circle at 40% 35%, #f2a468 0%, #d9703a 42%, #a34a26 78%, #6e2d18 100%)"
              : "radial-gradient(circle at 45% 40%, #6b4a35 0%, #43301f 60%, #2a2019 100%)",
          boxShadow: speaking
            ? "0 0 90px rgba(233,185,128,0.4), inset -18px -24px 48px rgba(90,45,20,0.55), inset 10px 14px 30px rgba(255,240,214,0.45)"
            : "0 0 80px rgba(224,138,84,0.35), inset -18px -24px 48px rgba(60,22,10,0.6), inset 10px 14px 30px rgba(255,196,150,0.35)",
        }}
        animate={
          muted
            ? { scale: 0.92, opacity: 0.7 }
            : speaking
              ? { scale: [1, 1.12, 0.97, 1.09, 1], borderRadius: ["50%", "48%", "52%", "49%", "50%"] }
              : listening
                ? { scale: [1, 1.07, 1.0, 1.1, 1.03, 1], borderRadius: ["50%", "52%", "48%", "53%", "49%", "50%"] }
                : { scale: [1, 0.96, 1] }
        }
        transition={
          muted
            ? { duration: 0.3 }
            : speaking
              ? { duration: 2.3, repeat: Infinity, ease: "easeInOut" }
              : listening
                ? { duration: 1.35, repeat: Infinity, ease: "easeInOut" }
                : { duration: 1.8, repeat: Infinity, ease: "easeInOut" }
        }
      >
        {/* Inner specular drift */}
        <motion.div
          aria-hidden
          className="absolute left-[22%] top-[18%] h-[38%] w-[34%] rounded-full"
          style={{ background: "radial-gradient(circle, rgba(255,255,255,0.5), transparent 70%)", filter: "blur(6px)" }}
          animate={{ x: [0, 14, -6, 0], y: [0, -8, 6, 0], opacity: [0.7, 0.9, 0.6, 0.7] }}
          transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
        />
      </motion.div>
    </div>
  );
}
