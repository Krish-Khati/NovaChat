"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { motion } from "framer-motion";
import {
  AlertCircle,
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Square,
  ThumbsDown,
  ThumbsUp,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Message as MessageType } from "@/lib/types";
import { useChatStore } from "@/store/chat-store";
import { CodeBlock } from "./code-block";

/**
 * One message row (ChatGPT-style column layout).
 * User messages: soft rounded rectangle, a shade off the page background,
 * left-aligned in the same 768px column as the assistant — NOT right-aligned.
 * Assistant messages: flush left text, no bubble, small circular mark.
 * Hover reveals an icon-only action row (copy, thumbs, regenerate, read).
 */
export function MessageRow({ message }: { message: MessageType }) {
  const isUser = message.role === "user";
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className={cn("group flex w-full gap-3 px-4 sm:px-6", isUser && "items-start")}
    >
      {/* Avatar — assistant only; user messages stand alone like ChatGPT */}
      {isUser ? (
        <div className="w-7 shrink-0" aria-hidden />
      ) : (
        <div
          aria-hidden
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground select-none"
        >
          <Sparkles size={13} strokeWidth={2.2} />
        </div>
      )}

      <div className="flex min-w-0 max-w-[768px] flex-1 flex-col">
        {isUser ? (
          <UserBubble message={message} />
        ) : (
          <AssistantBody message={message} />
        )}
      </div>
    </motion.div>
  );
}

/* ---------------------------------------------------------------- */

function UserBubble({ message }: { message: MessageType }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const editUserMessage = useChatStore((s) => s.editUserMessage);
  const isStreaming = useChatStore((s) => s.isStreaming);

  if (editing) {
    return (
      <form
        className="w-full min-w-[260px]"
        onSubmit={(e) => {
          e.preventDefault();
          editUserMessage(message.id, draft);
          setEditing(false);
        }}
      >
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={Math.min(10, Math.max(2, draft.split("\n").length))}
          className="w-full resize-y rounded-2xl border border-accent/50 bg-card px-4 py-3 text-[15px] outline-none focus:ring-2 focus:ring-ring"
        />
        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setDraft(message.content);
            }}
            className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!draft.trim() || isStreaming}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
          >
            Save & submit
          </button>
        </div>
      </form>
    );
  }

  return (
    <>
      <div className="max-w-[85%] self-start whitespace-pre-wrap rounded-2xl bg-muted px-4 py-2 text-[15px] leading-relaxed text-foreground">
        {message.content}
      </div>
      <div className="mt-1 flex translate-y-1 items-center gap-1 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
        <CopyButton text={message.content} />
        <button
          onClick={() => {
            setDraft(message.content);
            setEditing(true);
          }}
          disabled={isStreaming}
          className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
          title="Edit message"
          aria-label="Edit message"
        >
          <Pencil size={14} />
        </button>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- */

function AssistantBody({ message }: { message: MessageType }) {
  const regenerate = useChatStore((s) => s.regenerate);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const speakingMessageId = useChatStore((s) => s.speakingMessageId);
  const toggleSpeak = useChatStore((s) => s.toggleSpeak);
  const stopStreaming = useChatStore((s) => s.stopStreaming);
  const [vote, setVote] = useState<"up" | "down" | null>(null);
  const speaking = speakingMessageId === message.id;

  return (
    <>
      {message.status === "streaming" && message.content === "" ? (
        <ThinkingShimmer />
      ) : (
        <div className="md pt-1 text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              pre: ({ children }) => <>{children}</>,
              code: ({ className, children }) => {
                const match = /language-(\w+)/.exec(className || "");
                const raw = String(children).replace(/\n$/, "");
                if (match) {
                  return <CodeBlock language={match[1]} code={raw} />;
                }
                return <code className={className}>{children}</code>;
              },
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer noopener">
                  {children}
                </a>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
          {message.status === "streaming" && (
            <span className="ml-1 inline-block h-4 w-2 animate-pulse rounded-sm bg-accent align-[-2px]" />
          )}
        </div>
      )}

      {/* Citation chips (SerpApi grounding) */}
      {message.webSearched && message.citations && message.citations.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <Globe size={11} /> Sources
          </span>
          {message.citations.map((c, i) => (
            <a
              key={c.id}
              href={c.url}
              target="_blank"
              rel="noreferrer noopener"
              title={c.title}
              className="group/chip inline-flex max-w-[220px] items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-accent/50 hover:text-foreground"
            >
              <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[9px] font-bold text-accent">
                {i + 1}
              </span>
              <span className="truncate">{c.source}</span>
              <Link2 size={10} className="shrink-0 opacity-0 transition-opacity group-hover/chip:opacity-70" />
            </a>
          ))}
        </div>
      )}

      {/* Inline generation error — never crashes the transcript */}
      {message.error && (
        <div
          role="alert"
          className="mt-2 flex max-w-md items-start gap-2 rounded-2xl border border-[#e5484d]/40 bg-[#e5484d]/10 px-3 py-2 text-[12px] leading-snug text-[#ff8a8e]"
        >
          <AlertCircle size={14} className="mt-0.5 shrink-0" />
          <span>{message.error}</span>
        </div>
      )}

      {/* Action bar */}
      {message.status === "done" && (
        <div className="mt-1.5 flex translate-y-1 items-center gap-0.5 opacity-0 transition-all duration-150 group-hover:translate-y-0 group-hover:opacity-100 focus-within:translate-y-0 focus-within:opacity-100">
          <CopyButton text={message.content} />
          <button
            onClick={() => setVote((v) => (v === "up" ? null : "up"))}
            className={cn(
              "rounded-lg p-1.5 transition-colors hover:bg-muted",
              vote === "up" ? "text-accent" : "text-muted-foreground hover:text-foreground"
            )}
            title="Good response"
            aria-label="Good response"
            aria-pressed={vote === "up"}
          >
            <ThumbsUp size={14} fill={vote === "up" ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => setVote((v) => (v === "down" ? null : "down"))}
            className={cn(
              "rounded-lg p-1.5 transition-colors hover:bg-muted",
              vote === "down" ? "text-accent" : "text-muted-foreground hover:text-foreground"
            )}
            title="Bad response"
            aria-label="Bad response"
            aria-pressed={vote === "down"}
          >
            <ThumbsDown size={14} fill={vote === "down" ? "currentColor" : "none"} />
          </button>
          <button
            onClick={() => toggleSpeak(message.id, message.content)}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title={speaking ? "Stop reading" : "Read aloud"}
            aria-label={speaking ? "Stop reading" : "Read aloud"}
            aria-pressed={speaking}
          >
            {speaking ? (
              <span className="flex h-3.5 items-end gap-[2.5px] px-0.5" aria-hidden>
                {[0, 1, 2, 3].map((i) => (
                  <span
                    key={i}
                    className="w-[3px] origin-bottom animate-eq rounded-full bg-accent"
                    style={{ height: "100%", animationDelay: `${i * 0.13}s` }}
                  />
                ))}
              </span>
            ) : (
              <Volume2 size={14} />
            )}
          </button>
          <button
            onClick={regenerate}
            disabled={isStreaming}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            title="Regenerate response"
            aria-label="Regenerate response"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      )}

      {message.status === "streaming" && (
        <button
          onClick={stopStreaming}
          className="mt-2 inline-flex w-fit items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Square size={11} fill="currentColor" /> Stop generating
        </button>
      )}
    </>
  );
}

/* ---------------------------------------------------------------- */

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          /* clipboard unavailable — ignore */
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      title="Copy"
      aria-label="Copy to clipboard"
    >
      {copied ? <Check size={14} className="text-[var(--success)]" /> : <Copy size={14} />}
    </button>
  );
}

function ThinkingShimmer() {
  return (
    <div className="flex items-center gap-2 pt-2 text-sm text-muted-foreground">
      <Loader2 size={15} className="animate-spin text-accent" />
      <span className="bg-gradient-to-r from-muted-foreground via-foreground to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_1.6s_linear_infinite]">
        Thinking…
      </span>
      <style jsx global>{`
        @keyframes shimmer {
          from {
            background-position: 200% 0;
          }
          to {
            background-position: -200% 0;
          }
        }
      `}</style>
    </div>
  );
}
