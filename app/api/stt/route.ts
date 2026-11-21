import { NextResponse } from "next/server";

export const runtime = "nodejs";

const CARTESIA_VERSION = "2026-08-14";
const STT_URL = "https://api.cartesia.ai/stt";
const DEEPGRAM_URL = "https://api.deepgram.com/v1/listen?model=nova-3";

/** Deepgram raw-audio STT fallback. Returns transcript text or null. */
async function transcribeDeepgram(file: File, key: string): Promise<string | null> {
  try {
    const res = await fetch(DEEPGRAM_URL, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": file.type || "audio/webm",
      },
      body: await file.arrayBuffer(),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 200);
      console.warn(`[voice] Deepgram STT failed (${res.status}): ${detail}`);
      return null;
    }
    const json = await res.json().catch(() => null);
    const text = json?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim();
    return text || null;
  } catch (err) {
    console.warn("[voice] Deepgram STT error:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * POST /api/stt — audio file → transcript via Cartesia batch STT (ink-whisper).
 * Accepts multipart/form-data with `file` (webm/wav/mp3/…) plus optional
 * `cartesiaKey`. Keys: CARTESIA_API_KEY env wins; Settings key falls back.
 * Responds { text } or a JSON error payload.
 */
export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "invalid_form", message: "Expected multipart/form-data with an audio file." },
      { status: 400 }
    );
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { error: "missing_file", message: "`file` (audio) is required." },
      { status: 400 }
    );
  }
  if (file.size > 25 * 1024 * 1024) {
    return NextResponse.json(
      { error: "file_too_large", message: "Audio must be under 25 MB." },
      { status: 400 }
    );
  }

  const cartesiaKey = typeof form.get("cartesiaKey") === "string" ? String(form.get("cartesiaKey")) : undefined;
  const key = process.env.CARTESIA_API_KEY || cartesiaKey;
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

  const upstreamForm = new FormData();
  upstreamForm.append("file", file, file.name || "audio.webm");
  upstreamForm.append("model", "ink-whisper");
  upstreamForm.append("language", "en");

  let upstream: Response;
  try {
    upstream = await fetch(STT_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${key}`,
        "Cartesia-Version": CARTESIA_VERSION,
      },
      body: upstreamForm,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    // Cartesia unreachable → try Deepgram fallback before failing
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (dgKey) {
      console.warn("[voice] Cartesia unreachable, trying Deepgram fallback");
      const fb = await transcribeDeepgram(file, dgKey);
      if (fb) return NextResponse.json({ text: fb, provider: "deepgram" });
    }
    return NextResponse.json(
      {
        error: "network_error",
        message: `Could not reach Cartesia: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 502 }
    );
  }

  if (!upstream.ok) {
    // Any Cartesia failure incl. quota/credits exhausted (402/403/429) → Deepgram
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (dgKey) {
      console.warn(`[voice] Cartesia STT ${upstream.status}, trying Deepgram fallback`);
      const fb = await transcribeDeepgram(file, dgKey);
      if (fb) return NextResponse.json({ text: fb, provider: "deepgram" });
    }
    const detail = (await upstream.text().catch(() => "")).slice(0, 300);
    const status = upstream.status === 429 ? 429 : upstream.status >= 500 ? 502 : 400;
    return NextResponse.json(
      {
        error: upstream.status === 429 ? "rate_limited" : "cartesia_error",
        message:
          upstream.status === 429
            ? "Cartesia rate limit hit. Wait a moment and try again."
            : `Cartesia STT failed (${upstream.status}). ${detail}`,
      },
      { status }
    );
  }

  const json = await upstream.json().catch(() => null);
  const text = typeof json?.text === "string" ? json.text.trim() : "";
  if (!text) {
    // Cartesia heard nothing → give Deepgram a chance before failing
    const dgKey = process.env.DEEPGRAM_API_KEY;
    if (dgKey) {
      console.warn("[voice] Cartesia empty transcript, trying Deepgram fallback");
      const fb = await transcribeDeepgram(file, dgKey);
      if (fb) return NextResponse.json({ text: fb, provider: "deepgram" });
    }
    return NextResponse.json(
      { error: "empty_transcript", message: "No speech was detected in the recording." },
      { status: 422 }
    );
  }
  return NextResponse.json({ text });
}
