/**
 * Resolve a free OpenRouter text model for dedup, using the public models catalog.
 * @see https://openrouter.ai/docs/api/api-reference/models/get-models
 * @see https://openrouter.ai/models?output_modalities=text&order=pricing-low-to-high
 */

const MODELS_URL = "https://openrouter.ai/api/v1/models";

type OrModel = {
  id: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: {
    input_modalities?: string[];
    output_modalities?: string[];
    modality?: string;
  };
};

function isFreePricing(m: OrModel): boolean {
  const p = Number(m.pricing?.prompt ?? Number.NaN);
  const c = Number(m.pricing?.completion ?? Number.NaN);
  return Number.isFinite(p) && Number.isFinite(c) && p === 0 && c === 0;
}

/** Text-in / text-out only (skip audio/vision free promos). */
function isTextDedupShape(m: OrModel): boolean {
  const outs = m.architecture?.output_modalities ?? [];
  const ins = m.architecture?.input_modalities ?? [];
  if (!outs.includes("text") || !ins.includes("text")) return false;
  if (ins.includes("image") || ins.includes("video") || ins.includes("audio"))
    return false;
  const mod = m.architecture?.modality ?? "";
  if (/(audio|video|image)/i.test(mod)) return false;
  return true;
}

/**
 * Prefer these free slugs when present in the catalog (order = priority).
 * Refreshed from OpenRouter periodically; update when slugs rotate.
 */
export const DEDUP_FREE_MODEL_PREFERENCES: readonly string[] = [
  "liquid/lfm-2.5-1.2b-instruct:free",
  "google/gemma-4-26b-a4b-it:free",
  "deepseek/deepseek-v4-flash:free",
  "qwen/qwen3-coder:free",
  "openai/gpt-oss-20b:free",
  "nvidia/nemotron-3-nano-30b-a3b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "minimax/minimax-m2.5:free",
  "google/gemma-4-31b-it:free",
  "qwen/qwen3-next-80b-a3b-instruct:free",
  "openai/gpt-oss-120b:free",
  "z-ai/glm-4.5-air:free",
];

let cache: { model: string; at: number } | null = null;

function ttlMs(): number {
  const raw = process.env.CLEARBOLT_DEDUP_LLM_MODEL_LIST_TTL_MS?.trim();
  const n = raw ? Number.parseInt(raw, 10) : 6 * 60 * 60 * 1000;
  return Number.isFinite(n) && n >= 60_000 ? n : 6 * 60 * 60 * 1000;
}

/**
 * Picks a free text model from GET /api/v1/models (no API key required).
 * Preference order is {@link DEDUP_FREE_MODEL_PREFERENCES}; else first `:free` text id sorted.
 */
export async function resolveFreeDedupOpenRouterModel(): Promise<string> {
  const now = Date.now();
  if (cache && now - cache.at < ttlMs()) return cache.model;

  const res = await fetch(MODELS_URL, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`OpenRouter models list failed: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: OrModel[] };
  const rows = Array.isArray(body.data) ? body.data : [];
  const freeText = rows.filter((m) => isFreePricing(m) && isTextDedupShape(m));

  const ids = new Set(freeText.map((m) => m.id));
  for (const pref of DEDUP_FREE_MODEL_PREFERENCES) {
    if (ids.has(pref)) {
      cache = { model: pref, at: now };
      return pref;
    }
  }

  const freeSlugs = freeText
    .map((m) => m.id)
    .filter((id) => id.includes(":free"));
  const secondary = freeSlugs.filter((id) =>
    /instruct|coder|flash|nano|lfm|gemma|qwen|deepseek|minimax|gpt-oss|nemotron|glm-4\.5-air|dolphin|it:free|a4b-it/i.test(
      id,
    ),
  );
  const pool = secondary.length > 0 ? secondary : freeSlugs;
  if (pool.length === 0) {
    throw new Error("OpenRouter catalog has no zero-priced text models");
  }
  pool.sort((a, b) => a.length - b.length || a.localeCompare(b));
  const picked = pool[0];
  if (!picked) throw new Error("OpenRouter free model resolution empty");
  cache = { model: picked, at: now };
  return picked;
}

export function clearFreeDedupModelCacheForTests(): void {
  cache = null;
}
