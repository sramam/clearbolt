import type { FetchRequest, RawResponse } from "@clearbolt/core";
import type { Fetcher } from "./fetcher.js";
import { HttpFetcher } from "./http-fetcher.js";
import {
  proxySessionGeneration,
  proxySessionKeyForWorker,
  proxySessionRotateWindowMs,
} from "./proxy-session-rotate.js";

export type RotatingFetcherCloser = {
  fetch: Fetcher["fetch"];
  /** Force a new Decodo sticky session on this worker (e.g. after Akamai hard block). */
  rotateSession: () => void;
  close: () => Promise<void>;
};

function logProxyRotation(workerIndex: number, sessionKey: string): void {
  const windowMin =
    Math.round((proxySessionRotateWindowMs() / 60_000) * 10) / 10;
  const msg = `[proxy] worker ${workerIndex} → ${sessionKey} (rotate every ~${windowMin}m)`;
  if (process.env.CLEARBOLT_SCRAPER_DEBUG === "1") {
    console.error(msg);
    return;
  }
  if (process.env.CLEARBOLT_PROXY_ROTATION_LOG === "1") {
    console.log(msg);
  }
}

/**
 * HTTP fetcher that picks a new Decodo session key each rotation window.
 * Cheap to recreate (no browser); use for parallel listing ingest.
 */
export function createRotatingHttpFetcher(
  workerIndex: number,
): RotatingFetcherCloser {
  let generation = -1;
  /** Bumps past time-based generation after Akamai hard block on this worker. */
  let generationBump = 0;
  let fetcher = new HttpFetcher({
    sessionKey: proxySessionKeyForWorker(workerIndex, 0),
  });

  const effectiveGeneration = (): number =>
    proxySessionGeneration() + generationBump;

  const rebuildFetcher = (reason?: string): void => {
    const gen = effectiveGeneration();
    generation = gen;
    const sessionKey = proxySessionKeyForWorker(workerIndex, gen);
    fetcher = new HttpFetcher({ sessionKey });
    logProxyRotation(workerIndex, sessionKey);
    if (reason && process.env.CLEARBOLT_SCRAPER_DEBUG === "1") {
      console.error(`[proxy] worker ${workerIndex} rotate: ${reason}`);
    }
  };

  const ensureGeneration = (): void => {
    const gen = effectiveGeneration();
    if (gen === generation) return;
    rebuildFetcher();
  };

  return {
    async fetch(req: FetchRequest): Promise<RawResponse> {
      ensureGeneration();
      return fetcher.fetch(req);
    },
    rotateSession(): void {
      generationBump++;
      rebuildFetcher("manual");
    },
    async close(): Promise<void> {
      /* stateless HTTP */
    },
  };
}

export type RotatingBrowserFetcherOptions = {
  workerIndex?: number;
  proxyHostHint?: string;
  headless?: boolean;
};

/**
 * Playwright fetcher that closes and reopens Chromium when the proxy generation
 * changes (new Decodo sticky session). One instance per parallel worker.
 */
export async function createRotatingBrowserFetcher(
  options: RotatingBrowserFetcherOptions = {},
): Promise<RotatingFetcherCloser | null> {
  const workerIndex = options.workerIndex ?? 0;
  let generation = -1;
  let generationBump = 0;
  let session: { fetcher: Fetcher; close: () => Promise<void> } | null = null;

  const closeSession = async (): Promise<void> => {
    if (session) {
      await session.close();
      session = null;
    }
  };

  const ensureSession = async (): Promise<Fetcher> => {
    const gen = proxySessionGeneration() + generationBump;
    if (session && gen === generation) return session.fetcher;

    await closeSession();
    const { openBrowserSession } = await import("./browser-fetcher.js");
    const sessionKey = proxySessionKeyForWorker(workerIndex, gen);
    const opened = await openBrowserSession({
      proxyHostHint: options.proxyHostHint ?? "www.bizbuysell.com",
      sessionKey,
      headless: options.headless,
    });
    if (!opened) {
      throw new Error(
        `Playwright session failed to open for worker ${workerIndex} generation ${gen}`,
      );
    }
    generation = gen;
    session = opened;
    logProxyRotation(workerIndex, sessionKey);
    return opened.fetcher;
  };

  return {
    async fetch(req: FetchRequest): Promise<RawResponse> {
      const f = await ensureSession();
      return f.fetch(req);
    },
    rotateSession(): void {
      generationBump++;
      generation = -1;
      void closeSession();
    },
    close: closeSession,
  };
}
