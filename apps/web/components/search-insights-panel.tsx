"use client";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { SearchDiagnostics } from "@/lib/deals";
import { ChevronDown } from "lucide-react";

export function SearchInsightsPanel(props: {
  query: string;
  diagnostics: SearchDiagnostics | null;
  scrapedCount?: number | null;
  discoveryMode?: string | null;
}) {
  const { diagnostics, query, scrapedCount, discoveryMode } = props;
  if (!query.trim() && scrapedCount == null) return null;

  const d = diagnostics;
  const showNoStrict =
    d != null && d.strictMatchCount === 0 && d.relatedMatchCount > 0;

  return (
    <Collapsible defaultOpen={showNoStrict || (scrapedCount ?? 0) > 0}>
      <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-left text-sm font-medium hover:bg-muted/60">
        <span>Search insights</span>
        <ChevronDown className="size-4 shrink-0 transition-transform [[data-state=open]_&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
        {scrapedCount != null && !Number.isNaN(scrapedCount) ? (
          <p>
            Fetched{" "}
            <span className="font-medium text-foreground">{scrapedCount}</span>{" "}
            listing{scrapedCount === 1 ? "" : "s"}
            {discoveryMode === "serper"
              ? " (Serper URLs → BizBuySell details)"
              : discoveryMode
                ? ` via ${discoveryMode}`
                : ""}
            . Results below include your full corpus, not only this batch.
          </p>
        ) : null}

        {d ? (
          <>
            <p>
              Searching for:{" "}
              <code className="rounded bg-muted px-1 text-foreground">
                {d.prepared.searchKeywords || query}
              </code>
            </p>
            {d.prepared.expansions.length > 0 ? (
              <p>Adjustments: {d.prepared.expansions.join(" · ")}</p>
            ) : null}
            {d.llmSynonyms.length > 0 ? (
              <p>
                AI also tried:{" "}
                <span className="text-foreground">
                  {d.llmSynonyms.join(", ")}
                </span>
              </p>
            ) : null}
            <p>
              Strict match:{" "}
              <span className="font-medium text-foreground">
                {d.prepared.ftsQuery || "—"}
              </span>{" "}
              ({d.strictMatchCount} hit{d.strictMatchCount === 1 ? "" : "s"})
            </p>
            <p>
              Related (any term):{" "}
              <span className="font-medium text-foreground">
                {d.relaxedFtsUsed}
              </span>{" "}
              ({d.relatedMatchCount} hit{d.relatedMatchCount === 1 ? "" : "s"})
            </p>
            {showNoStrict ? (
              <p className="text-foreground">
                No listings contain every word in your query. Showing related
                matches that include at least one term — try fewer words or
                different keywords (like Google&apos;s &quot;Results for
                …&quot;).
              </p>
            ) : null}
            {d.usedOrFallback ? (
              <p>In-memory fallback used (index may still be warming).</p>
            ) : null}
          </>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
