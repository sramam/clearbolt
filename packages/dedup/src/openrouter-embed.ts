import { resolveDedupEmbedOpenRouterModel } from "./openrouter-resolve-embed-model.js";

const OPENROUTER_EMBEDDINGS_URL =
  "https://openrouter.ai/api/v1/embeddings" as const;

export interface EmbedOpenRouterOpts {
  model?: string;
  signal?: AbortSignal;
}

/**
 * OpenRouter exposes an OpenAI-compatible embeddings API. Model slugs include
 * open-weight / research checkpoints (e.g. E5, GTE, Nomic) and proprietary APIs;
 * see https://openrouter.ai/models?output_modalities=embeddings
 *
 * When `opts.model` and `CLEARBOLT_DEDUP_EMBED_MODEL` are unset, the model is chosen from the
 * public embeddings catalog (free first, then cheapest paid). See `resolveDedupEmbedOpenRouterModel`.
 */
export async function embedTextsOpenRouter(
  texts: string[],
  opts?: EmbedOpenRouterOpts,
): Promise<number[][] | null> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return null;
  const model =
    opts?.model ??
    (process.env.CLEARBOLT_DEDUP_EMBED_MODEL?.trim() ||
      (await resolveDedupEmbedOpenRouterModel()));
  const input = texts.map((t) => (t.length > 24_000 ? t.slice(0, 24_000) : t));
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input }),
    signal: opts?.signal,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `OpenRouter embeddings HTTP ${res.status}: ${body.slice(0, 400)}`,
    );
  }
  const json = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  const rows = json.data ?? [];
  const sorted = [...rows].sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

export async function embedTextOpenRouter(
  text: string,
  opts?: EmbedOpenRouterOpts,
): Promise<number[] | null> {
  const batch = await embedTextsOpenRouter([text], opts);
  return batch?.[0] ?? null;
}
