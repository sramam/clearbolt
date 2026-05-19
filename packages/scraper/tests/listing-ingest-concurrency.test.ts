import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { clearProxyEndpointsFileCache } from "../src/proxy-endpoints-file.js";
import {
  resolveBrowserFallbackWorkerCount,
  resolveListingIngestConcurrency,
} from "../src/bizbuysell-run-policy.js";

function writeProxyFile(lineCount: number): string {
  const path = join(
    tmpdir(),
    `proxy-${lineCount}-${randomBytes(4).toString("hex")}.txt`,
  );
  const lines = Array.from(
    { length: lineCount },
    (_, i) => `https://u:p@us.decodo.com:${10001 + i}`,
  ).join("\n");
  writeFileSync(path, lines);
  return path;
}

describe("resolveListingIngestConcurrency", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    clearProxyEndpointsFileCache();
    delete process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE;
    delete process.env.CLEARBOLT_PROXY_POLICY;
    delete process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST;
    delete process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP;
    delete process.env.CLEARBOLT_SCRAPE_CONCURRENCY;
  });

  it("caps HTTP workers when many proxy ports are configured", () => {
    const path50 = writeProxyFile(50);
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path50;
    process.env.CLEARBOLT_PROXY_POLICY = "residential";
    try {
      expect(resolveListingIngestConcurrency()).toBe(12);
      clearProxyEndpointsFileCache();
      const path7 = writeProxyFile(7);
      process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path7;
      expect(resolveListingIngestConcurrency()).toBe(7);
      unlinkSync(path7);
    } finally {
      unlinkSync(path50);
    }
  });

  it("uses HTTP ingest with multi-proxy even when BROWSER_FIRST=1", () => {
    const path = writeProxyFile(12);
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path;
    process.env.CLEARBOLT_PROXY_POLICY = "residential";
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    try {
      expect(
        resolveListingIngestConcurrency({ useRotatingHttpWorkers: true }),
      ).toBe(12);
    } finally {
      unlinkSync(path);
    }
  });

  it("CLEARBOLT_SCRAPE_CONCURRENCY cannot exceed proxy file size", () => {
    const path = writeProxyFile(50);
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path;
    process.env.CLEARBOLT_PROXY_POLICY = "residential";
    process.env.CLEARBOLT_SCRAPE_CONCURRENCY = "99";
    try {
      expect(resolveListingIngestConcurrency()).toBe(50);
    } finally {
      unlinkSync(path);
    }
  });

  it("CLEARBOLT_SCRAPE_CONCURRENCY may lower parallelism", () => {
    const path = writeProxyFile(50);
    process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE = path;
    process.env.CLEARBOLT_PROXY_POLICY = "residential";
    process.env.CLEARBOLT_SCRAPE_CONCURRENCY = "8";
    try {
      expect(resolveListingIngestConcurrency()).toBe(8);
    } finally {
      unlinkSync(path);
    }
  });

  it("browser fallback pool is capped below HTTP worker count", () => {
    delete process.env.CLEARBOLT_BROWSER_FALLBACK_WORKERS;
    expect(resolveBrowserFallbackWorkerCount(50)).toBe(4);
    expect(resolveBrowserFallbackWorkerCount(2)).toBe(2);
    process.env.CLEARBOLT_BROWSER_FALLBACK_WORKERS = "6";
    expect(resolveBrowserFallbackWorkerCount(50)).toBe(6);
  });
});
