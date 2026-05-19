import { z } from "zod";
import { resolveFreeDedupOpenRouterModel } from "@clearbolt/dedup";
import {
  BrokerSiteListingExtractSchema,
  type BrokerSiteListingExtract,
} from "./parse-broker-site-listing.js";

const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

const LlmListingItemSchema = z.object({
  title: z.string().optional(),
  askingPrice: z.number().optional(),
  state: z.string().optional(),
  city: z.string().optional(),
  location: z.string().optional(),
  revenue: z.number().optional(),
  cashFlow: z.number().optional(),
  industry: z.string().optional(),
  listingUrl: z.string().optional(),
});

const LlmListingSchema = z.object({
  listings: z.array(LlmListingItemSchema).optional(),
});

type LlmListingItem = z.infer<typeof LlmListingItemSchema>;

export function brokerSiteLlmExtractEnabled(): boolean {
  return process.env.CLEARBOLT_BROKER_SITE_LLM_EXTRACT?.trim() === "1";
}

function extractJsonObject(text: string): unknown {
  const t = text.trim();
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON object in LLM response");
    return JSON.parse(m[0]!);
  }
}

export async function extractListingsFromIndexViaLlm(
  plainText: string,
  pageUrl: string,
  brokerContext?: { firmName?: string; siteUrl?: string },
): Promise<BrokerSiteListingLinkFromLlm[]> {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY required for broker-site LLM extract");
  }
  const model =
    process.env.CLEARBOLT_BROKER_SITE_LLM_MODEL?.trim() ||
    (await resolveFreeDedupOpenRouterModel());

  const system = `You extract business-for-sale listings from broker website HTML text.
Return JSON only: { "listings": [{ "title", "askingPrice", "state", "city", "location", "revenue", "cashFlow", "industry", "listingUrl" }] }.
Use absolute listingUrl when possible (same site as the page). Do not include BizBuySell, BizQuest, LoopNet, or other marketplace URLs.`;

  const user = [
    brokerContext?.firmName ? `Broker firm: ${brokerContext.firmName}` : "",
    brokerContext?.siteUrl ? `Site: ${brokerContext.siteUrl}` : "",
    `Page: ${pageUrl}`,
    "",
    plainText.slice(0, 24_000),
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer":
        process.env.CLEARBOLT_OPENROUTER_HTTP_REFERER?.trim() ||
        "https://clearbolt.local",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.1,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${errText.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const parsed = LlmListingSchema.parse(extractJsonObject(content));
  return (parsed.listings ?? []).map((l: LlmListingItem) => ({
    url: l.listingUrl ?? pageUrl,
    title: l.title,
    extract: BrokerSiteListingExtractSchema.parse({
      title: l.title,
      askingPrice: l.askingPrice,
      state: l.state,
      city: l.city,
      location: l.location,
      revenue: l.revenue,
      cashFlow: l.cashFlow,
      industry: l.industry,
    }),
  }));
}

export type BrokerSiteListingLinkFromLlm = {
  url: string;
  title?: string;
  extract?: BrokerSiteListingExtract;
};
