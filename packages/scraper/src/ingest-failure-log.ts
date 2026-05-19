import { appendFile } from "node:fs/promises";
import type { ListingRef } from "@clearbolt/core";

export type IngestFailureRecord = {
  at: string;
  url: string;
  externalId?: string;
  message: string;
};

/** Normalize errors for logs and grouping (message + optional cause). */
export function formatIngestError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message.trim()];
  const cause = err.cause;
  if (cause instanceof Error && cause.message.trim()) {
    parts.push(`cause: ${cause.message.trim()}`);
  }
  return parts.join(" | ");
}

/** Bucket key for end-of-run summary (strip URLs and listing ids). */
export function ingestErrorBucket(message: string): string {
  return message
    .replace(/https?:\/\/\S+/gi, "<url>")
    .replace(/\b\d{6,}\b/g, "<id>")
    .slice(0, 200);
}

export class IngestFailureCollector {
  private readonly failures: IngestFailureRecord[] = [];

  get count(): number {
    return this.failures.length;
  }

  record(ref: ListingRef, err: unknown): IngestFailureRecord {
    const entry: IngestFailureRecord = {
      at: new Date().toISOString(),
      url: ref.url,
      externalId: ref.externalId,
      message: formatIngestError(err),
    };
    this.failures.push(entry);
    return entry;
  }

  logFailure(ref: ListingRef, err: unknown): void {
    const entry = this.record(ref, err);
    const id = entry.externalId ? ` #${entry.externalId}` : "";
    console.error(`[ingest] failed${id} ${entry.url}\n         ${entry.message}`);
  }

  printSummary(): void {
    if (this.failures.length === 0) return;
    const byBucket = new Map<string, { count: number; sample: string }>();
    for (const f of this.failures) {
      const bucket = ingestErrorBucket(f.message);
      const prev = byBucket.get(bucket);
      if (prev) prev.count++;
      else byBucket.set(bucket, { count: 1, sample: f.message });
    }
    const ranked = [...byBucket.entries()].sort((a, b) => b[1].count - a[1].count);
    console.error(
      `[ingest] ${this.failures.length} failure(s) — top error kinds:`,
    );
    for (const [bucket, { count, sample }] of ranked.slice(0, 8)) {
      console.error(`  ${count}× ${sample || bucket}`);
    }
    const logPath = process.env.CLEARBOLT_SCRAPE_FAILURE_LOG?.trim();
    if (logPath) {
      console.error(`[ingest] full failure log: ${logPath}`);
    }
  }

  async appendJsonl(filePath: string): Promise<void> {
    if (this.failures.length === 0) return;
    const lines = this.failures.map((f) => `${JSON.stringify(f)}\n`).join("");
    await appendFile(filePath, lines, "utf8");
  }
}
