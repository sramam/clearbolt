import type { SourceRecord } from "@clearbolt/core";
import { resolveFreeDedupOpenRouterModel } from "./openrouter-resolve-dedup-model.js";

function summarize(r: SourceRecord): string {
  const p = r.parsedFields;
  return [
    `adapter=${r.adapter}`,
    `url=${r.url}`,
    r.externalId ? `externalId=${r.externalId}` : "",
    p.title ? `title=${p.title}` : "",
    typeof p.askingPrice === "number" ? `askingPrice=${p.askingPrice}` : "",
    p.state ? `state=${p.state}` : "",
    p.city ? `city=${p.city}` : "",
    p.industry ? `industry=${p.industry}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parsePSame(text: string): number | null {
  const t = text.trim();
  try {
    const j = JSON.parse(t) as { p_same?: unknown };
    if (typeof j.p_same === "number" && Number.isFinite(j.p_same)) {
      return Math.min(1, Math.max(0, j.p_same));
    }
  } catch {
    /* fall through */
  }
  const m = t.match(/"p_same"\s*:\s*([\d.]+)/);
  if (m) {
    const n = Number.parseFloat(m[1] ?? "");
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  }
  return null;
}

/**
 * Optional cheap-chat similarity via OpenRouter (same model slugs as openrouter.ai).
 * Returns null when not configured or on transport/parse failure — caller keeps programmatic score only.
 *
 * Env:
 * - `OPENROUTER_API_KEY` — required to enable
 * - `CLEARBOLT_DEDUP_LLM_MODEL` — when set, forces that model id. When unset, picks a **free** text model from the public [models list](https://openrouter.ai/api/v1/models) (cached; preference list in `openrouter-resolve-dedup-model.ts`), then falls back to `meta-llama/llama-3.2-1b-instruct` if the catalog call fails.
 * - `CLEARBOLT_DEDUP_LLM_MODEL_LIST_TTL_MS` — cache TTL for the free-model catalog (default 6h).
 * - `CLEARBOLT_OPENROUTER_HTTP_REFERER` — OpenRouter asks for a referer URL; default GitHub placeholder
 */
export async function llmDedupSimilarityOpenRouter(
  a: SourceRecord,
  b: SourceRecord,
): Promise<number | null> {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  if (!key) return null;

  const explicit = process.env.CLEARBOLT_DEDUP_LLM_MODEL?.trim();
  let model: string;
  if (explicit) {
    model = explicit;
  } else {
    try {
      model = await resolveFreeDedupOpenRouterModel();
    } catch {
      model = "meta-llama/llama-3.2-1b-instruct";
    }
  }
  const referer =
    process.env.CLEARBOLT_OPENROUTER_HTTP_REFERER?.trim() ||
    "https://github.com/clearbolt/clearbolt";

  const user = `You classify whether two marketplace listings are the SAME underlying business (one seller, one deal), not merely similar industry.

Listing A:
${summarize(a)}

Listing B:
${summarize(b)}

Reply with ONLY valid JSON: {"p_same": <number>} where p_same is your probability in [0,1].`;

  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "HTTP-Referer": referer,
        "X-OpenRouter-Title": "Clearbolt dedup",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              "You output only a single JSON object with key p_same. No markdown fences, no prose.",
          },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") return null;
    return parsePSame(text);
  } catch {
    return null;
  }
}
