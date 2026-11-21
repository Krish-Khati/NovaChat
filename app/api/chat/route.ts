import Groq from "groq-sdk";
import { serpApiSearch } from "@/lib/server/search";
import { DEFAULT_MODEL, GROQ_MODELS } from "@/lib/data";

export const runtime = "nodejs";

/**
 * POST /api/chat — streaming Groq chat completion (OpenAI-compatible, SSE).
 *
 * Body: {
 *   messages: { role: "user" | "assistant", content: string }[],
 *   webSearch?: boolean,        // ON → SerpApi grounding before the LLM call
 *   model?: string,             // defaults to llama-3.3-70b-versatile
 *   groqKey?: string,           // fallback when GROQ_API_KEY env is unset
 *   serpapiKey?: string,        // fallback when SERPAPI_API_KEY env is unset
 * }
 *
 * Stream wire format (text/event-stream, `data: <json>\n\n` lines):
 *   {"type":"phase","value":"searching"|"thinking"}
 *   {"type":"meta","webSearched":true,"citations":[{id,title,snippet,url,source}],"warning"?:string}
 *   {"type":"delta","content":"..."}*
 *   {"type":"error","message":"..."}
 *   {"type":"done"}  followed by `data: [DONE]`
 *
 * Keys: GROQ_API_KEY / SERPAPI_API_KEY from env win; Settings-provided
 * in-memory keys are the fallback. Neither is ever echoed to the client.
 */

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

const today = () =>
  new Date().toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

function buildSystemPrompt(grounding: string | null): string {
  const base = [
    "You are NovaChat, a personal AI assistant.",
    `Today's date is ${today()}.`,
    "Answer in markdown. Be concise and direct unless the user asks for depth.",
    "When the question depends on current events or recent facts, say when the information may have changed since your training data.",
  ];
  if (grounding) {
    base.push(
      "",
      "Use the following current web results as your primary source for time-sensitive facts. Ground your answer in them, and mention the source name naturally where it matters (e.g. \"according to The Verge…\"):",
      "",
      grounding
    );
  }
  return base.join("\n");
}

function citationId(i: number) {
  return `src-${Date.now().toString(36)}-${i}`;
}

export async function POST(req: Request) {
  let body: {
    messages?: { role: string; content: string }[];
    webSearch?: boolean;
    model?: string;
    groqKey?: string;
    serpapiKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Body must be JSON.");
  }

  const history = (body.messages ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-24);
  if (history.length === 0) {
    return jsonError(400, "missing_messages", "`messages` must contain at least one user message.");
  }

  const groqKey = process.env.GROQ_API_KEY || body.groqKey;
  if (!groqKey) {
    return jsonError(
      400,
      "missing_api_key",
      "GROQ_API_KEY is not set. Add it to .env.local, or enter it in Settings → API keys."
    );
  }

  const model =
    body.model && GROQ_MODELS.some((m) => m.id === body.model) ? body.model : DEFAULT_MODEL;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(sse(obj));
      try {
        // ---- Grounding pass (optional) -------------------------------
        let grounding: string | null = null;
        let citations: ReturnType<typeof toCitations> = [];
        let warning: string | undefined;

        if (body.webSearch) {
          send({ type: "phase", value: "searching" });
          const lastUser = [...history].reverse().find((m) => m.role === "user");
          const search = await serpApiSearch(lastUser?.content ?? "", body.serpapiKey, 5);
          if (search.ok && search.results.length > 0) {
            grounding = search.results
              .map(
                (r, i) =>
                  `[${i + 1}] ${r.title} — ${r.snippet}\n    Source: ${r.source || r.url}`
              )
              .join("\n");
            citations = toCitations(search.results);
            send({ type: "meta", webSearched: true, citations });
          } else {
            warning =
              search.ok
                ? "Search returned no results — answered from the model's own knowledge."
                : search.reason === "missing_key"
                  ? "SERPAPI_API_KEY is not set — answered without web grounding."
                  : `Web search failed (${search.detail ?? "unknown error"}) — answered without grounding.`;
            send({ type: "meta", webSearched: false, citations: [], warning });
          }
        }
        send({ type: "phase", value: "thinking" });

        // ---- Groq completion, streamed -------------------------------
        const groq = new Groq({ apiKey: groqKey });
        const completion = await groq.chat.completions.create({
          model,
          temperature: 0.7,
          stream: true,
          messages: [
            { role: "system", content: buildSystemPrompt(grounding) },
            ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
          ],
        });

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) send({ type: "delta", content: delta });
        }
        send({ type: "done" });
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err) {
        const { message, code } = groqError(err);
        send({ type: "error", message: `${message}`, code });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

function toCitations(results: { title: string; snippet: string; url: string; source: string }[]) {
  return results.map((r, i) => ({
    id: citationId(i),
    title: r.title,
    snippet: r.snippet,
    url: r.url,
    source: r.source || r.url,
  }));
}

function jsonError(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function groqError(err: unknown): { message: string; code: string } {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 401 || status === 403)
    return { message: "Groq rejected the API key (401/403). Check GROQ_API_KEY.", code: "auth" };
  if (status === 429)
    return { message: "Groq rate limit hit. Wait a moment and try again.", code: "rate_limit" };
  if (status && status >= 500)
    return { message: `Groq is having issues (${status}). Try again shortly.`, code: "upstream" };
  return { message: `Chat request failed: ${raw.slice(0, 300)}`, code: "unknown" };
}
