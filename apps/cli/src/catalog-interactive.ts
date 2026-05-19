import { access } from "node:fs/promises";
import {
  CATALOG_SOURCES,
  catalogRefsReadPathCandidates,
  defaultCatalogRefsPath,
  isCatalogDiscoveryComplete,
  readCatalogRefsFile,
  resolveCatalogRefsPath,
  resolveCatalogUrl,
  type CatalogSourceId,
} from "@clearbolt/scraper";
import { dataRoot } from "./bind-storage.js";
import { promptChoice, promptLine, promptYesNo } from "./prompt.js";

export type CatalogInteractiveResult = {
  /** argv tail for `cmdCatalog` (flags only; URL via --source or positional). */
  args: string[];
};

/** User already picked a mode on the CLI — do not launch the interactive wizard. */
const CATALOG_EXPLICIT_MODE_FLAGS = [
  "--retry-failures-only",
  "--refresh",
  "--discover-only",
  "--force-discovery",
] as const;

export function catalogArgsHaveExplicitMode(args: string[]): boolean {
  if (CATALOG_EXPLICIT_MODE_FLAGS.some((f) => args.includes(f))) return true;
  const refsIdx = args.indexOf("--refs-file");
  if (refsIdx !== -1 && refsIdx + 1 < args.length && args[refsIdx + 1]?.trim()) {
    return true;
  }
  return false;
}

async function cachedRefsSummary(
  sourceId: CatalogSourceId,
  catalogUrl: string,
): Promise<string | null> {
  const root = dataRoot();
  for (const candidate of catalogRefsReadPathCandidates(catalogUrl, root)) {
    try {
      await access(resolveCatalogRefsPath(candidate));
      const file = await readCatalogRefsFile(candidate);
      if (file.adapter !== sourceId) continue;
      const complete = isCatalogDiscoveryComplete(file);
      return `${file.refs.length} ref(s) ${complete ? "complete" : "in progress"} @ ${candidate}`;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Interactive catalog wizard — returns CLI args to pass into `cmdCatalog`.
 */
export async function buildCatalogArgsInteractive(): Promise<CatalogInteractiveResult> {
  const sourceChoices = await Promise.all(
    CATALOG_SOURCES.map(async (s) => {
      const cache = await cachedRefsSummary(s.id, s.defaultCatalogUrl);
      const ingest = s.ingestSupported ? "ingest ok" : "discover only";
      const browser = s.browserRequired ? "browser" : "HTTP ok";
      const hint = [ingest, browser, cache ?? "no cache", s.notes].join(" · ");
      return { value: s.id, label: s.label, hint };
    }),
  );

  const sourceId = await promptChoice<CatalogSourceId>(
    "Marketplace source",
    sourceChoices,
    "bizbuysell",
  );
  const source = CATALOG_SOURCES.find((s) => s.id === sourceId)!;

  const useCustomUrl = await promptYesNo(
    "Use a custom catalog URL instead of the default?",
    false,
  );
  let catalogUrl = source.defaultCatalogUrl;
  if (useCustomUrl) {
    catalogUrl = await promptLine("Catalog URL", source.defaultCatalogUrl);
  }

  const cache = await cachedRefsSummary(sourceId, catalogUrl);
  const modeChoices: Array<{
    value: string;
    label: string;
    hint?: string;
  }> = [
    {
      value: "discover",
      label: "Discover only",
      hint: "walk catalog / write refs, no listing fetch",
    },
  ];
  if (source.ingestSupported) {
    modeChoices.push({
      value: "ingest",
      label: "Discover + ingest",
      hint: "fetch listings into metadata (respects CLEARBOLT_SCRAPE_LIMIT / --ingest)",
    });
  }
  if (cache) {
    modeChoices.push({
      value: "resume",
      label: "Resume",
      hint: `use cache: ${cache}`,
    });
  }
  modeChoices.push({
    value: "refresh",
    label: "Refresh",
    hint: "re-walk catalog and re-fetch listings",
  });

  const mode = await promptChoice("Run mode", modeChoices, cache ? "resume" : "discover");

  const args: string[] = ["--source", sourceId];
  if (useCustomUrl || catalogUrl !== source.defaultCatalogUrl) {
    args.push(catalogUrl);
  }

  if (mode === "discover") args.push("--discover-only");
  if (mode === "refresh") args.push("--refresh");
  if (mode === "resume") {
    /* default cmdCatalog resume when cache complete */
  }

  if (mode === "ingest" && source.ingestSupported) {
    const limit = await promptLine(
      "Ingest how many listings? (empty = env CLEARBOLT_SCRAPE_LIMIT / 10)",
      "",
    );
    if (limit) args.push("--ingest", limit);
  }

  const capPages = await promptYesNo("Cap catalog pages?", false);
  if (capPages) {
    const pages = await promptLine("Max catalog pages", "5");
    if (pages) args.push("--pages", pages);
  }

  if (source.fixturesSupported) {
    const fixtures = await promptYesNo("Use BizBuySell fixtures?", false);
    if (fixtures) args.push("--fixtures");
  }

  if (source.browserRequired || sourceId === "bizbuysell") {
    const headed = await promptYesNo("Headed Chromium (visible window)?", false);
    if (headed) args.push("--headed");
  }

  const defaultPath = defaultCatalogRefsPath(catalogUrl, dataRoot());
  console.log(`\nWill run: clearbolt catalog ${args.join(" ")}`);
  console.log(`Catalog refs path: ${defaultPath}`);
  const go = await promptYesNo("Start now?", true);
  if (!go) {
    console.log("Cancelled.");
    process.exit(0);
  }

  return { args };
}

/** Resolve `--source` flag from argv before positional URL. */
export function parseCatalogSourceFlag(args: string[]): {
  sourceId?: string;
  rest: string[];
} {
  const rest: string[] = [];
  let sourceId: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--source" && i + 1 < args.length) {
      sourceId = args[i + 1]!.trim();
      i++;
      continue;
    }
    rest.push(a);
  }
  return { sourceId, rest };
}

export function catalogUrlFromArgs(
  sourceId: string | undefined,
  positional: string | undefined,
): string {
  return resolveCatalogUrl(sourceId, positional);
}
