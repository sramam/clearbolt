import { resolveFreeDedupOpenRouterModel } from "@clearbolt/dedup";
import { htmlListingBodyPlainText } from "../html-body-fingerprint.js";
import {
  type ListingLlmEnrichPatch,
  ListingLlmEnrichPatchSchema,
} from "../listing-llm-enrich-schema.js";
import type { BizBuySellListingExtract } from "./bizbuysell-listing-parse.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

export function llmListingEnrichEnabled(): boolean {
  return process.env.CLEARBOLT_LISTING_LLM_ENRICH?.trim() === "1";
}

/** True when deterministic parse left category or sale-structure fields blank. */
export function listingHasLlmEnrichGaps(
  extract: BizBuySellListingExtract,
): boolean {
  const noCategory =
    !extract.category?.trim() &&
    !(extract.categories && extract.categories.length > 0);
  const noEmployees = !extract.numberOfEmployees?.trim();
  const inventoryAmbiguous =
    Boolean(extract.inventory?.trim()) &&
    extract.inventoryIncludedInAskingPrice === undefined;
  const ffeAmbiguous =
    Boolean(extract.ffe?.trim()) &&
    extract.ffeIncludedInAskingPrice === undefined;
  const noIndustry = !extract.industry?.trim();
  return (
    noCategory ||
    noEmployees ||
    inventoryAmbiguous ||
    ffeAmbiguous ||
    noIndustry
  );
}

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON object in LLM response");
    const jsonRaw = m[0];
    if (jsonRaw === undefined)
      throw new Error("no JSON object in LLM response");
    return JSON.parse(jsonRaw);
  }
}

/**
 * Apply LLM patch only where the adapter left blanks (unless overwrite env is set).
 */
export function mergeListingLlmPatch(
  extract: BizBuySellListingExtract,
  patch: ListingLlmEnrichPatch,
  opts?: { overwrite?: boolean },
): void {
  const overwrite = opts?.overwrite ?? false;

  const setIfBlank = <K extends keyof BizBuySellListingExtract>(
    key: K,
    value: BizBuySellListingExtract[K] | undefined,
  ) => {
    if (value === undefined || value === null || value === "") return;
    const current = extract[key];
    if (
      !overwrite &&
      current !== undefined &&
      current !== null &&
      current !== ""
    ) {
      return;
    }
    extract[key] = value;
  };

  setIfBlank("category", patch.category);
  if (patch.categories?.length && (overwrite || !extract.categories?.length)) {
    extract.categories = patch.categories;
    if (!extract.finalCategory || overwrite) {
      extract.finalCategory =
        patch.finalCategory ?? patch.categories[patch.categories.length - 1];
    }
  } else {
    setIfBlank("finalCategory", patch.finalCategory);
  }
  setIfBlank("industry", patch.industry);
  setIfBlank("numberOfEmployees", patch.numberOfEmployees);
  setIfBlank("sellerType", patch.sellerType);
  setIfBlank("reasonForSelling", patch.reasonForSelling);

  if (
    patch.inventoryIncludedInAskingPrice !== undefined &&
    (overwrite || extract.inventoryIncludedInAskingPrice === undefined)
  ) {
    extract.inventoryIncludedInAskingPrice =
      patch.inventoryIncludedInAskingPrice;
  }
  if (
    patch.ffeIncludedInAskingPrice !== undefined &&
    (overwrite || extract.ffeIncludedInAskingPrice === undefined)
  ) {
    extract.ffeIncludedInAskingPrice = patch.ffeIncludedInAskingPrice;
  }

  if (extract.finalCategory && !extract.industry) {
    extract.industry = extract.finalCategory;
  }
}

function buildEnrichPrompt(
  extract: BizBuySellListingExtract,
  bodyText: string,
): string {
  const known = {
    title: extract.title,
    location: extract.location,
    category: extract.category,
    categories: extract.categories,
    industry: extract.industry,
    numberOfEmployees: extract.numberOfEmployees,
    inventory: extract.inventory,
    inventoryIncludedInAskingPrice: extract.inventoryIncludedInAskingPrice,
    ffe: extract.ffe,
    ffeIncludedInAskingPrice: extract.ffeIncludedInAskingPrice,
    askingPrice: extract.askingPrice,
    revenue: extract.revenue,
    sellerType: extract.sellerType,
    reasonForSelling: extract.reasonForSelling,
  };
  return `You enrich business-for-sale listings for ETA searchers. Use ONLY facts stated in the listing text. Do not invent numbers or categories.

Already extracted (do not contradict):
${JSON.stringify(known, null, 2)}

Listing body text:
${bodyText}

Reply with ONLY valid JSON matching this shape (omit keys you cannot support from the text):
{
  "category": string | optional — top-level industry label,
  "categories": string[] | optional — breadcrumb path e.g. ["California", "Manufacturing", "Stone"],
  "finalCategory": string | optional — leaf category,
  "industry": string | optional — same as finalCategory when useful for search,
  "numberOfEmployees": string | optional — e.g. "10 Full-time",
  "inventoryIncludedInAskingPrice": boolean | optional,
  "ffeIncludedInAskingPrice": boolean | optional — furniture/fixtures/equipment included in asking price,
  "sellerType": string | optional,
  "reasonForSelling": string | optional — short phrase,
  "confidence": "low" | "medium" | "high"
}

Rules:
- Set inventoryIncludedInAskingPrice / ffeIncludedInAskingPrice to true only when the text clearly says included in asking price (or equivalent); false when clearly excluded; omit if unknown.
- Prefer filling category/categories from breadcrumbs or industry wording in the body.
- numberOfEmployees: copy the listing's wording when present.`;
}

/**
 * Optional OpenRouter enrich (`CLEARBOLT_LISTING_LLM_ENRICH=1`, `OPENROUTER_API_KEY`).
 * Fills category taxonomy and ambiguous sale-structure fields; never replaces non-empty adapter fields.
 */
export async function enrichListingWithLlm(
  extract: BizBuySellListingExtract,
  html: string,
): Promise<boolean> {
  if (!llmListingEnrichEnabled()) return false;
  if (!listingHasLlmEnrichGaps(extract)) return false;

  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) return false;

  const model =
    process.env.CLEARBOLT_LISTING_LLM_MODEL?.trim() ??
    (await resolveFreeDedupOpenRouterModel().catch(
      () => "meta-llama/llama-3.2-1b-instruct",
    ));
  const referer =
    process.env.CLEARBOLT_OPENROUTER_HTTP_REFERER?.trim() ||
    "https://github.com/clearbolt/clearbolt";
  const overwrite = process.env.CLEARBOLT_LISTING_LLM_OVERWRITE?.trim() === "1";

  const bodyText = htmlListingBodyPlainText(html, 10_000);
  if (!bodyText.trim()) return false;

  try {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": referer,
        "X-OpenRouter-Title": "Clearbolt listing enrich",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You output only a single JSON object. No markdown fences, no prose.",
          },
          { role: "user", content: buildEnrichPrompt(extract, bodyText) },
        ],
      }),
    });
    if (!res.ok) return false;

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) return false;

    const raw = extractJsonObject(content);
    const parsed = ListingLlmEnrichPatchSchema.safeParse(raw);
    if (!parsed.success) return false;

    mergeListingLlmPatch(extract, parsed.data, { overwrite });
    extract.enrichSources = [
      ...(extract.enrichSources ?? []),
      "llm-openrouter",
    ];
    return true;
  } catch {
    return false;
  }
}
