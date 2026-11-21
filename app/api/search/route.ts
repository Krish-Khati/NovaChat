import { NextResponse } from "next/server";
import { serpApiSearch } from "@/lib/server/search";

export const runtime = "nodejs";

/**
 * POST /api/search — Google results via SerpApi.
 * Body: { query: string, serpapiKey?: string }
 * The key falls back: SERPAPI_API_KEY env → serpapiKey from the request
 * body (Settings, in-memory). Keys never travel further than this route.
 */
export async function POST(req: Request) {
  let body: { query?: string; serpapiKey?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json", message: "Body must be JSON." }, { status: 400 });
  }
  const query = body.query?.trim();
  if (!query) {
    return NextResponse.json({ error: "missing_query", message: "`query` is required." }, { status: 400 });
  }

  const result = await serpApiSearch(query, body.serpapiKey, 5);
  if (!result.ok) {
    const status = result.reason === "missing_key" ? 400 : 502;
    return NextResponse.json(
      {
        error: result.reason,
        message:
          result.reason === "missing_key"
            ? "SERPAPI_API_KEY is not set. Add it to .env.local or enter it in Settings → API keys."
            : `Search failed. ${result.detail ?? ""}`.trim(),
      },
      { status }
    );
  }
  return NextResponse.json({ organic: result.results });
}
