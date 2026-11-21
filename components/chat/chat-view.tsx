"use client";

import { useEffect, useRef } from "react";
import { Globe, Loader2 } from "lucide-react";
import { useChatStore } from "@/store/chat-store";
import { MessageRow } from "./message";
import { InputBar } from "./input-bar";
import { cn } from "@/lib/utils";

/** Transcript + phase indicator + composer for the active conversation. */
export function ChatView() {
  const conversation = useChatStore((s) =>
    s.conversations.find((c) => c.id === s.activeId) ?? null
  );
  const isStreaming = useChatStore((s) => s.isStreaming);
  const webSearchPhase = useChatStore((s) => s.webSearchPhase);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const messageCount = conversation?.messages.length ?? 0;
  const lastContentLength =
    conversation?.messages[conversation.messages.length - 1]?.content.length ?? 0;

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messageCount, lastContentLength]);

  // Fresh conversation → jump to top-of-empty / bottom
  useEffect(() => {
    pinnedToBottom.current = true;
  }, [conversation?.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Transcript */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label="Conversation transcript"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4 py-5">
          {conversation?.messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}

          {/* "Thinking / searching the web" indicator */}
          {isStreaming && webSearchPhase !== "idle" && (
            <div
              className="flex items-center gap-2.5 px-4 pl-14 text-[13px] text-muted-foreground sm:px-6 sm:pl-16"
              role="status"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/12 text-accent">
                {webSearchPhase === "searching" ? (
                  <Globe size={13} className="animate-pulse" />
                ) : (
                  <Loader2 size={13} className="animate-spin" />
                )}
              </span>
              {webSearchPhase === "searching" ? (
                <span className="bg-gradient-to-r from-muted-foreground via-accent to-muted-foreground bg-[length:200%_100%] bg-clip-text text-transparent animate-[shimmer_1.6s_linear_infinite]">
                  Searching the web…
                </span>
              ) : (
                <span>Thinking…</span>
              )}
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
          )}
          <div className={cn("h-2")} />
        </div>
      </div>

      <InputBar />
    </div>
  );
}
