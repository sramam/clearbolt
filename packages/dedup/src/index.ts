export type { DedupKeyer } from "./keyer.js";
export {
  BizBuySellDedupKeyer,
  BizQuestDedupKeyer,
  BusinessBrokerDedupKeyer,
  DealStreamDedupKeyer,
  GenericDedupKeyer,
  BrokerSiteDedupKeyer,
} from "./keyer.js";
export { ingestSourceRecord } from "./ingest.js";
export type { IngestSourceOptions, IngestSourceResult } from "./ingest.js";
export {
  latestListingFetchAt,
  listingFetchMinIntervalMs,
  listingFetchSkipKnown,
  shouldSkipListingFetch,
} from "./listing-fetch-cooldown.js";
export type { ListingFetchSkipReason } from "./listing-fetch-cooldown.js";
export {
  embedTextOpenRouter,
  embedTextsOpenRouter,
} from "./openrouter-embed.js";
export type { EmbedOpenRouterOpts } from "./openrouter-embed.js";
export {
  DEDUP_FREE_EMBED_MODEL_PREFERENCES,
  clearDedupEmbedModelCacheForTests,
  resolveDedupEmbedOpenRouterModel,
} from "./openrouter-resolve-embed-model.js";
export { llmDedupSimilarityOpenRouter } from "./scorer-llm-openrouter.js";
export {
  DEDUP_FREE_MODEL_PREFERENCES,
  clearFreeDedupModelCacheForTests,
  resolveFreeDedupOpenRouterModel,
} from "./openrouter-resolve-dedup-model.js";
export {
  cosineSimilarity,
  mergeDecide,
  scorePair,
  scorePairAsync,
  scorePairBodyEmbedding,
  scorePairGeo,
  scorePairLexical,
  scorePairNumeric,
} from "./scorer.js";
export type { MergeAction, ScoreResult } from "./scorer.js";
