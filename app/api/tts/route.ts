import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CARTESIA_VERSION = "2026-08-14";
const TTS_URL = "https://api.cartesia.ai/tts/bytes";
const MODEL = "sonic-latest";

/**
 * POST /api/tts — text → mp3 bytes via Cartesia.
 * Body: { text: string, voiceId?: string, cartesiaKey?: string }
 * Keys: CARTESIA_API_KEY env wins; Settings-provided key is the fallback.
 * Response: audio/mpeg stream. Errors carry JSON details so the client
 * can toast something actionable instead of crashing.
 */
export async function POST(req: Request) {
  let body: { text?: string; voiceId?: string; cartesiaKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Body must be JSON." }, { status: 400 });
  }
  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "missing_text", message: "`text` is required." }, { status: 400 });
  }

  const key = process.env.CARTESIA_API_KEY || body.cartesiaKey;
  if (!key) {
    return NextResponse.json(
      {
        error: "missing_api_key",
        message:
          "CARTESIA_API_KEY is not set. Add it to .env.local, or enter it in Settings → API keys.",
      },
      { status: 400 }
    );
  }

  // Cartesia caps useful transcript length; clamp to keep latency sane.
  const transcript = text.slice(0, 5000);
  const voiceId = body.voiceId || "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4";

  let upstream: Response;
  try {
    upstream = await fetch(TTS_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Cartesia-Version": CARTESIA_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model_id: MODEL,
        transcript,
        voice: { id: voiceId },
        language: "en",
        output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "network_error",
        message: `Could not reach Cartesia: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
    return NextResponse.json(
      {
        error: upstream.status === 429 ? "rate_limited" : "cartesia_error",
        message:
          upstream.status === 429
            ? "Cartesia rate limit hit. Wait a moment and try again."
            : `Cartesia TTS failed (${upstream.status}). ${detail}`,
      },
      { status }
    );
  }

  const audio = await upstream.arrayBuffer();
  return new Response(audio, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
