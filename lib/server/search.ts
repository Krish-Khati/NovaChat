/**
 * SerpApi (Google Search) service. SERVER-SIDE ONLY.
 * Used by /api/search and, internally, by /api/chat for grounding.
 */

export interface OrganicResult {
  title: string;
  snippet: string;
  url: string;
  source: string; // display hostname, e.g. "theverge.com"
}

export type SearchResult =
  | { ok: true; results: OrganicResult[] }
  | { ok: false; reason: "missing_key" | "http_error" | "network_error"; detail?: string };

const hostname = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export async function serpApiSearch(
  query: string,
  apiKey: string | undefined,
  num = 5
): Promise<SearchResult> {
  const key = process.env.SERPAPI_API_KEY || apiKey;
  if (!key) return { ok: false, reason: "missing_key" };

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", key);
  url.searchParams.set("num", String(num));

  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    return {
      ok: false,
      reason: "network_error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "http_error",
      detail: `SerpApi ${res.status}: ${body.slice(0, 200)}`,
    };
  }

  const json = await res.json().catch(() => null);
  const organic = (json?.organic_results ?? []) as Array<{
    title?: string;
    snippet?: string;
    link?: string;
  }>;
  const results: OrganicResult[] = organic
    .slice(0, num)
    .filter((r) => r.title && r.link)
    .map((r) => ({
      title: r.title!,
      snippet: r.snippet ?? "",
      url: r.link!,
      source: hostname(r.link!),
    }));
  return { ok: true, results };
}
