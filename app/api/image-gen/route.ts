export const runtime = "nodejs";
/** Pollinations can take 10-20s+ for a fresh image — give it room. */
export const maxDuration = 60;

/**
 * GET /api/image-gen?prompt=...&seed=... — server-side proxy for
 * Pollinations image generation (no API key needed). We fetch upstream and
 * stream the bytes back so the client never sees the raw Pollinations URL
 * and errors/timeouts come back as clean JSON.
 *
 * `seed` varies the output — regenerate passes a new random seed.
 */

const POLLINATIONS_TIMEOUT_MS = 45_000;
const MAX_PROMPT = 1000;

function jsonError(status: number, error: string, message: string) {
  return new Response(JSON.stringify({ error, message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const prompt = (searchParams.get("prompt") ?? "").trim();
  if (!prompt) {
    return jsonError(400, "missing_prompt", "`prompt` query parameter is required.");
  }
  if (prompt.length > MAX_PROMPT) {
    return jsonError(400, "prompt_too_long", `Prompt must be under ${MAX_PROMPT} characters.`);
  }

  const seedParam = Number.parseInt(searchParams.get("seed") ?? "", 10);
  const seed = Number.isFinite(seedParam) && seedParam >= 0 ? seedParam : Math.floor(Math.random() * 1_000_000);

  const upstream = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}` +
    `?width=1024&height=1024&nologo=true&seed=${seed}`;

  let res: Response;
  try {
    res = await fetch(upstream, {
      signal: AbortSignal.timeout(POLLINATIONS_TIMEOUT_MS),
      // Hot-reload pages re-request identical seeds — let Next cache it upstream
      cache: "force-cache",
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return jsonError(
      504,
      timedOut ? "image_gen_timeout" : "image_gen_unreachable",
      timedOut
        ? "Image generation timed out after 45s. Pollinations can be slow — try again."
        : `Couldn't reach the image service: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!res.ok) {
    return jsonError(
      502,
      "image_gen_failed",
      `Image service returned ${res.status}. Try again — a new seed often works.`
    );
  }

  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) {
    return jsonError(502, "image_gen_bad_response", "Image service returned a non-image response. Try again.");
  }

  const bytes = await res.arrayBuffer();
  return new Response(bytes, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=31536000, immutable",
      "X-Seed": String(seed),
    },
  });
}
