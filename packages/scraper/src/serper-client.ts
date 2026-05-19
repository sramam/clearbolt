/**
 * Serper.dev Google SERP API (https://serper.dev).
 * Env: `SERP_DEV_API_KEY` (Clearbolt name) or `SERPER_API_KEY`.
 */

const SERPER_SEARCH_URL = "https://google.serper.dev/search";

export interface SerperOrganicResult {
  title?: string;
  link?: string;
  snippet?: string;
  position?: number;
}

export interface SerperSearchResponse {
  organic?: SerperOrganicResult[];
  searchParameters?: { q?: string };
}

export function serperApiKeyFromEnv(): string | null {
  const key =
    process.env.SERP_DEV_API_KEY?.trim() ||
    process.env.SERPER_API_KEY?.trim() ||
    "";
  return key || null;
}

export interface SerperSearchOptions {
  num?: number;
  gl?: string;
  hl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export async function serperSearch(
  query: string,
  options: SerperSearchOptions = {},
): Promise<SerperSearchResponse> {
  const apiKey = options.apiKey ?? serperApiKeyFromEnv();
  if (!apiKey) {
    throw new Error(
      "SERP_DEV_API_KEY or SERPER_API_KEY is required for Serper search",
    );
  }
  const q = query.trim();
  if (!q) throw new Error("Serper query is required");

  const fetchImpl = options.fetchImpl ?? fetch;
  const res = await fetchImpl(SERPER_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": apiKey,
    },
    body: JSON.stringify({
      q,
      num: options.num ?? 10,
      ...(options.gl ? { gl: options.gl } : {}),
      ...(options.hl ? { hl: options.hl } : {}),
    }),
  });

  const body = (await res.json()) as SerperSearchResponse & {
    message?: string;
    statusCode?: number;
  };

  if (!res.ok) {
    const msg = body.message ?? res.statusText;
    throw new Error(`Serper search failed (${res.status}): ${msg}`);
  }

  return body;
}
