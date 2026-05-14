export type { DedupKeyer } from "./keyer.js";
export { BizBuySellDedupKeyer, GenericDedupKeyer } from "./keyer.js";
export { ingestSourceRecord } from "./ingest.js";
export type { IngestSourceOptions } from "./ingest.js";
export {
  mergeDecide,
  scorePair,
  scorePairGeo,
  scorePairLexical,
  scorePairNumeric,
} from "./scorer.js";
export type { MergeAction, ScoreResult } from "./scorer.js";
