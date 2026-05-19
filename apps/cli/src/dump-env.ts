import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  akamaiHardBlockProxyRetryAttempts,
  residentialProxyConfigured,
  residentialProxyEndpointCount,
  shouldPreferHttpIngestForBizBuySell,
  shouldPreferMobileBizBuySellCatalog,
  shouldPreferMobileBizBuySellListing,
  shouldUseBrowserFallbackForBizBuySellListingIngest,
  shouldUseBrowserFirstForBizBuySell,
  shouldUseHttpProxyFirstForBizBuySell,
} from "@clearbolt/scraper";
import { dataRoot, loadRepoEnv } from "./bind-storage.js";

const REDACT_KEY =
  /(SECRET|PASSWORD|TOKEN|API[_-]?KEY|DATABASE_URL|OPENROUTER|RESEND|NEON|R2_|AUTH|BEARER|CREDENTIAL)/i;

function redactValue(key: string, value: string): string {
  if (REDACT_KEY.test(key)) {
    if (value.length <= 8) return "***";
    return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
  }
  try {
    const u = new URL(value);
    if (u.password || u.username) {
      u.password = u.password ? "***" : "";
      u.username = u.username ? "***" : "";
      return u.toString();
    }
  } catch {
    /* not a url */
  }
  return value;
}

function shouldIncludeEnvKey(key: string): boolean {
  return (
    key.startsWith("CLEARBOLT_") ||
    key.startsWith("OPENROUTER_") ||
    key === "DATA_DIR" ||
    key === "NODE_ENV" ||
    key === "DATABASE_URL"
  );
}

function collectClearboltEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (!shouldIncludeEnvKey(key)) continue;
    if (value === undefined) continue;
    out[key] = redactValue(key, value);
  }
  return Object.fromEntries(
    Object.entries(out).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function resolvedScraperFlags(): Record<string, boolean | number | string> {
  return {
    residentialProxyConfigured: residentialProxyConfigured(),
    residentialProxyEndpointCount: residentialProxyEndpointCount(),
    shouldUseBrowserFirstForBizBuySell: shouldUseBrowserFirstForBizBuySell(),
    shouldUseHttpProxyFirstForBizBuySell:
      shouldUseHttpProxyFirstForBizBuySell(),
    shouldPreferMobileBizBuySellCatalog: shouldPreferMobileBizBuySellCatalog(),
    shouldPreferMobileBizBuySellListing: shouldPreferMobileBizBuySellListing(),
    shouldPreferHttpIngestForBizBuySell: shouldPreferHttpIngestForBizBuySell(),
    shouldUseBrowserFallbackForBizBuySellListingIngest:
      shouldUseBrowserFallbackForBizBuySellListingIngest(),
    akamaiHardBlockProxyRetryAttempts: akamaiHardBlockProxyRetryAttempts(),
    listingFetchSkipKnown:
      process.env.CLEARBOLT_LISTING_FETCH_SKIP_KNOWN ?? "(unset)",
    scrapeConcurrency: process.env.CLEARBOLT_SCRAPE_CONCURRENCY ?? "(unset)",
    browserHeadless: process.env.CLEARBOLT_BROWSER_HEADLESS ?? "(unset)",
    proxySessionId: process.env.CLEARBOLT_PROXY_SESSION_ID ?? "(unset)",
  };
}

export type DumpRunEnvOptions = {
  /** CLI argv tail after subcommand (for audit). */
  argv?: string[];
  /** Extra notes (e.g. catalog mode). */
  notes?: Record<string, string | boolean | number>;
  outPath?: string;
};

/** Write redacted env + resolved flags for debugging scraper runs. */
export async function dumpRunEnv(
  options: DumpRunEnvOptions = {},
): Promise<string> {
  loadRepoEnv();
  const at = new Date().toISOString();
  const slug = at.replace(/[:.]/g, "-");
  const defaultPath = join(dataRoot(), "debug", `env-dump-${slug}.json`);
  const outPath = options.outPath ?? defaultPath;

  const payload = {
    at,
    cwd: process.cwd(),
    argv: options.argv ?? [],
    notes: options.notes ?? {},
    env: collectClearboltEnv(),
    resolved: resolvedScraperFlags(),
  };

  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return outPath;
}

export function shouldDumpEnvFromArgv(args: string[]): boolean {
  if (process.env.CLEARBOLT_DUMP_ENV?.trim() === "1") return true;
  return args.includes("--dump-env");
}

export function parseDumpEnvPath(args: string[]): {
  rest: string[];
  dumpPath?: string;
} {
  const rest: string[] = [];
  let dumpPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === "--dump-env") {
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        dumpPath = next;
        i++;
      }
      continue;
    }
    rest.push(a);
  }
  return { rest, dumpPath };
}
