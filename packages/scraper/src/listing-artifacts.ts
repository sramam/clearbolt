import type {
  ParsedListingFields,
  ProcessedArtifacts,
  ProcessedArtifactKind,
} from "@clearbolt/core";
import type { BizBuySellListingExtract } from "./adapters/bizbuysell-listing-parse.js";
import { BIZBUYSELL_LISTING_PARSER_VERSION } from "./adapters/bizbuysell-listing-parse.js";
import type {
  ProcessedArtifactStore,
  ProcessedPutMeta,
} from "@clearbolt/storage";
import { htmlListingBodyText } from "./html-body-fingerprint.js";

export const LISTING_PARSER_VERSION = BIZBUYSELL_LISTING_PARSER_VERSION;

export interface ListingArtifactInput {
  adapter: string;
  sourceUrl: string;
  rawEvidenceSha256: string;
  html: string;
  parsed: (ParsedListingFields & { externalId?: string }) | BizBuySellListingExtract;
  bodyEmbedding?: number[];
  bodyEmbeddingModel?: string;
}

/** Plain-text markdown-ish body for search, wiki, and replay (Defuddle later). */
export function htmlToListingMarkdown(
  html: string,
  meta: { title?: string; url: string },
): string {
  const title = meta.title?.trim() || "Listing";
  const body = htmlListingBodyText(html);
  return `# ${title}\n\nSource: ${meta.url}\n\n${body}\n`;
}

function apifyAlignedFields(
  parsed: ListingArtifactInput["parsed"],
): Record<string, unknown> {
  const e = parsed as BizBuySellListingExtract;
  return {
    dateAdded: e.dateAdded,
    title: e.title,
    location: e.location,
    state: e.stateName ?? e.state,
    yearEstablished: e.yearEstablished,
    status: e.status,
    linkToDeal: e.linkToDeal ?? undefined,
    category: e.category,
    categories: e.categories,
    finalCategory: e.finalCategory,
    price: e.askingPrice,
    revenue: e.revenue,
    ebitda: e.ebitda,
    cashFlow: e.cashFlow,
    industryDetails: e.industryDetails,
    numberOfEmployees: e.numberOfEmployees,
    inventory: e.inventory,
    inventoryValue: e.inventoryValue,
    inventoryIncludedInAskingPrice: e.inventoryIncludedInAskingPrice,
    ffeIncludedInAskingPrice: e.ffeIncludedInAskingPrice,
    rent: e.rent,
    rentAmount: e.rentAmount,
    reasonForSelling: e.reasonForSelling,
    sellerType: e.sellerType,
    realEstate: e.realEstate,
    buildingSf: e.buildingSf,
    facilities: e.facilities,
    ffe: e.ffe,
    intermediaryName: e.intermediaryName,
    intermediaryFirm: e.intermediaryFirm,
    intermediaryPhone: e.intermediaryPhone,
    intermediaryEmail: e.intermediaryEmail,
    brokerProfileUrl: e.brokerProfileUrl,
    brokerageNote: e.brokerageNote,
    soldSource: e.soldSource,
    agentUrl: e.agentUrl,
    agentWebsite: e.agentWebsite,
    growthAndExpansion: e.growthAndExpansion,
    financing: e.financing,
    supportAndTraining: e.supportAndTraining,
    franchise: e.franchise,
    competition: e.competition,
    homeBased: e.homeBased,
    tagline: e.tagline,
    imageUrls: e.imageUrls,
    geo: e.geo,
    extraDetails: e.extraDetails,
  };
}

export function buildStructuredListingJson(
  input: ListingArtifactInput,
): Record<string, unknown> {
  return {
    parserVersion: LISTING_PARSER_VERSION,
    url: input.sourceUrl,
    externalId: input.parsed.externalId ?? input.parsed.listingId,
    scrapedAt: new Date().toISOString(),
    derivedFromEvidenceSha256: input.rawEvidenceSha256,
    fields: input.parsed,
    apify: apifyAlignedFields(input.parsed),
  };
}

export function buildClassificationJson(
  input: ListingArtifactInput,
): Record<string, unknown> {
  const e = input.parsed as BizBuySellListingExtract;
  const llmEnriched = e.enrichSources?.includes("llm-openrouter") ?? false;
  return {
    parserVersion: LISTING_PARSER_VERSION,
    url: input.sourceUrl,
    industry: input.parsed.industry ?? null,
    category: e.category ?? null,
    categories: e.categories ?? null,
    finalCategory: e.finalCategory ?? null,
    state: input.parsed.state ?? null,
    city: input.parsed.city ?? null,
    title: input.parsed.title ?? null,
    method: llmEnriched ? "adapter+llm-enrich" : "adapter-heuristic",
    enrichSources: e.enrichSources ?? [],
    note: llmEnriched
      ? "Categories and gap fields filled by optional LLM enrich pass"
      : "Deterministic adapter parse; enable CLEARBOLT_LISTING_LLM_ENRICH for gap-fill",
  };
}

async function putJson(
  store: ProcessedArtifactStore,
  base: Omit<ProcessedPutMeta, "contentType" | "kind">,
  kind: ProcessedArtifactKind,
  value: unknown,
): Promise<ProcessedArtifacts[keyof ProcessedArtifacts]> {
  const buf = Buffer.from(JSON.stringify(value, null, 2), "utf8");
  return store.put(buf, {
    ...base,
    kind,
    contentType: "application/json",
  });
}

/**
 * Persist processed listing artifacts beside raw HTML on object storage (R2 or disk).
 */
export async function persistListingProcessedArtifacts(
  store: ProcessedArtifactStore,
  input: ListingArtifactInput,
): Promise<ProcessedArtifacts> {
  const base = {
    adapter: input.adapter,
    sourceUrl: input.sourceUrl,
    derivedFromSha256: input.rawEvidenceSha256,
    parserVersion: LISTING_PARSER_VERSION,
  };

  const markdown = await store.put(
    Buffer.from(
      htmlToListingMarkdown(input.html, {
        title: input.parsed.title,
        url: input.sourceUrl,
      }),
      "utf8",
    ),
    { ...base, kind: "markdown", contentType: "text/markdown" },
  );

  const structured = await putJson(
    store,
    base,
    "structured",
    buildStructuredListingJson(input),
  );

  const out: ProcessedArtifacts = { markdown, structured };

  if (input.bodyEmbedding?.length) {
    out.embedding = await putJson(store, base, "embedding", {
      parserVersion: LISTING_PARSER_VERSION,
      model: input.bodyEmbeddingModel ?? "unknown",
      dimensions: input.bodyEmbedding.length,
      vector: input.bodyEmbedding,
      derivedFromEvidenceSha256: input.rawEvidenceSha256,
    });
  }

  out.classification = await putJson(
    store,
    base,
    "classification",
    buildClassificationJson(input),
  );

  return out;
}
