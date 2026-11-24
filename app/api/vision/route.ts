import Groq from "groq-sdk";
import { VISION_MODEL } from "@/lib/data";

export const runtime = "nodejs";

/**
 * POST /api/vision — streaming Groq vision completion (SSE, same wire
 * format as /api/chat) for "what's in this image?" style prompts.
 *
 * Body: {
 *   prompt?: string,             // optional text; defaults to a describe request
 *   imageUrl: string,            // base64 data URL (data:image/...;base64,...)
 *   history?: { role, content }[], // prior turns, text-only
 *   groqKey?: string,            // fallback when GROQ_API_KEY env is unset
 * }
 *
 * Model: qwen/qwen3.8-27b (Groq's vision model on this account).
 * Limits per Groq docs: 20MB per request, max 3 images, data-URL embedding.
 */

const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // Groq's documented request limit
const ALLOWED = /^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=]+$/i;

const enc = new TextEncoder();
const sse = (obj: unknown) => enc.encode(`data: ${JSON.stringify(obj)}\n\n`);

function jsonError(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request) {
  let body: {
    prompt?: string;
    imageUrl?: string;
    history?: { role: string; content: string }[];
    groqKey?: string;
  };
  try {
    body = await req.json();
  } catch {
    return jsonError(400, "invalid_json", "Body must be JSON.");
  }

  const imageUrl = body.imageUrl ?? "";
  if (!imageUrl.startsWith("data:image/")) {
    return jsonError(400, "missing_image", "`imageUrl` (base64 data URL) is required.");
  }
  if (!ALLOWED.test(imageUrl)) {
    return jsonError(
      400,
      "unsupported_format",
      "Unsupported image format — use PNG, JPEG, WebP or GIF."
    );
  }
  // base64 inflates size ~4/3 — compare the encoded payload against the limit
  if (imageUrl.length > MAX_IMAGE_BYTES) {
    return jsonError(
      413,
      "image_too_large",
      "Image is too large for Groq (20MB limit). Pick a smaller image."
    );
  }

  const groqKey = process.env.GROQ_API_KEY || body.groqKey;
  if (!groqKey) {
    return jsonError(
      400,
      "missing_api_key",
      "GROQ_API_KEY is not set. Add it to .env.local, or enter it in Settings → API keys."
    );
  }

  const prompt = body.prompt?.trim() || "What's in this image?";
  const history = (body.history ?? [])
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content?.trim())
    .slice(-23);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(sse(obj));
      try {
        send({ type: "phase", value: "thinking" });
        const groq = new Groq({ apiKey: groqKey });
        const completion = await groq.chat.completions.create({
          model: VISION_MODEL,
          temperature: 0.7,
          stream: true,
          messages: [
            {
              role: "system",
              content:
                "You are NovaChat, a personal AI assistant. The user has shared an image with you — describe and answer questions about it accurately. Base your answer on what is actually visible; never invent details you cannot see. Answer in markdown, concise and direct.",
            },
            ...history.map((m) => ({
              role: m.role as "user" | "assistant",
              content: m.content,
            })),
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                { type: "image_url", image_url: { url: imageUrl } },
              ],
            },
          ],
        });

        for await (const chunk of completion) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) send({ type: "delta", content: delta });
        }
        send({ type: "done" });
        controller.enqueue(enc.encode("data: [DONE]\n\n"));
      } catch (err) {
        send({ type: "error", message: visionError(err) });
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

function visionError(err: unknown): string {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const raw = err instanceof Error ? err.message : String(err);
  if (status === 400) return `Groq rejected the image or request (400): ${raw.slice(0, 200)}`;
  if (status === 401 || status === 403) return "Groq rejected the API key (401/403). Check GROQ_API_KEY.";
  if (status === 429) return "Groq rate limit hit. Wait a moment and try again.";
  if (status && status >= 500) return `Groq is having issues (${status}). Try again shortly.`;
  return `Vision request failed: ${raw.slice(0, 300)}`;
}
