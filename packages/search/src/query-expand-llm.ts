import type { PreparedSearchQuery } from "./query-prepare.js";

export interface LlmQueryExpansion {
  /** Extra OR terms for Postgres FTS (space-separated). */
  ftsOrTerms: string;
  synonyms: string[];
  note: string;
}

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Optional OpenRouter synonym expansion (`CLEARBOLT_SEARCH_EXPAND_LLM=1`). */
export async function expandSearchQueryWithLlm(
  prepared: PreparedSearchQuery,
  opts?: { signal?: AbortSignal },
): Promise<LlmQueryExpansion | null> {
  if (process.env.CLEARBOLT_SEARCH_EXPAND_LLM !== "1") return null;
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey || !prepared.searchKeywords) return null;

  const model =
    process.env.CLEARBOLT_SEARCH_EXPAND_MODEL?.trim() ??
    "google/gemini-2.0-flash-001";

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You help ETA searchers find SMB acquisition listings. Reply with JSON only: {\"synonyms\": string[], \"note\": string}. Synonyms are 3-8 alternate search terms or phrases (single words preferred) related to the user query for business-for-sale search. Do not repeat the original words verbatim.",
        },
        {
          role: "user",
          content: prepared.raw,
        },
      ],
    }),
    signal: opts?.signal,
  });

  if (!res.ok) return null;
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content?.trim();
  if (!content) return null;

  try {
    const parsed = JSON.parse(content) as {
      synonyms?: string[];
      note?: string;
    };
    const synonyms = (parsed.synonyms ?? [])
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 8);
    if (synonyms.length === 0) return null;
    return {
      ftsOrTerms: synonyms.join(" | "),
      synonyms,
      note: parsed.note?.trim() ?? "AI suggested related terms",
    };
  } catch {
    return null;
  }
}

/** Merge deterministic + LLM expansions into one relaxed FTS string. */
export function mergeRelaxedFtsQuery(
  prepared: PreparedSearchQuery,
  llm: LlmQueryExpansion | null,
): string {
  const parts = [prepared.ftsQueryRelaxed];
  if (llm?.ftsOrTerms) parts.push(llm.ftsOrTerms);
  return parts.filter(Boolean).join(" | ");
}
