export interface WebBizBuySellScrapeInput {
  searchUrl: string;
  searchKeywords?: string;
  limit?: number;
  useFixtures?: boolean;
  discovery?: "serper" | "direct" | "fixtures" | "direct+serper";
  skipBrowser?: boolean;
}

export interface WebBizBuySellScrapeResult {
  listingsIngested: number;
  searchEvidenceKey: string;
  effectiveSearchUrl: string;
  discoveryMode: "serper" | "direct" | "fixtures" | "direct+serper";
  canonicalIds: string[];
}

export interface ScrapeProgressEvent {
  phase: string;
  message: string;
  current?: number;
  total?: number;
}
