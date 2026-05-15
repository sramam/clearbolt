import { mkdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { SourceRecordSchema } from "@clearbolt/core";
import type { RawResponse } from "@clearbolt/core";
import { BizBuySellDedupKeyer, ingestSourceRecord } from "@clearbolt/dedup";
import {
  BIZBUYSELL_ADAPTER_ID,
  HttpFetcher,
  MockFetcher,
  buildSourceRecord,
  discoverListingRefs,
  fetchHtmlWithHttpWafPolicy,
  fetchListingHtmlWithWafPolicy,
  parseListingPage,
  parseSearchUrl,
} from "@clearbolt/scraper";
import { DiskEvidenceStore, DiskMetadataStore } from "@clearbolt/storage";

const __dirname = dirname(fileURLToPath(import.meta.url));

function dataRoot(): string {
  return process.env.DATA_DIR ?? join(process.cwd(), "data");
}

async function streamToString(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function runCli(argv: string[]): Promise<void> {
  const [, , cmd, ...rest] = argv;
  if (!cmd || cmd === "help" || cmd === "-h") {
    console.log(`clearbolt scrape <bizbuysell-search-url> [--fixtures]
clearbolt deals list
clearbolt replay
Env: DATA_DIR (default ./data), CLEARBOLT_SCRAPE_LIMIT (default 10)`);
    return;
  }
  if (cmd === "scrape") {
    await cmdScrape(rest);
    return;
  }
  if (cmd === "deals" && rest[0] === "list") {
    await cmdDealsList();
    return;
  }
  if (cmd === "replay") {
    await cmdReplay();
    return;
  }
  throw new Error(`unknown command: ${cmd}`);
}

async function cmdScrape(args: string[]): Promise<void> {
  const useFixtures = args.includes("--fixtures");
  const urls = args.filter((a) => !a.startsWith("--"));
  const searchUrlArg = urls[0];
  if (!searchUrlArg)
    throw new Error("usage: clearbolt scrape <url> [--fixtures]");
  parseSearchUrl(searchUrlArg);

  const effectiveSearch = useFixtures
    ? "https://www.bizbuysell.com/businesses-for-sale/"
    : searchUrlArg;

  const root = dataRoot();
  await mkdir(root, { recursive: true });
  const evidence = new DiskEvidenceStore(root);
  const meta = new DiskMetadataStore(root);
  const fetcher = useFixtures ? await buildFixtureFetcher() : new HttpFetcher();
  const limit = Number.parseInt(process.env.CLEARBOLT_SCRAPE_LIMIT ?? "10", 10);

  const persistNeedsBrowser = async (host: string) => {
    await meta.putDomainProfile({
      host,
      needsBrowser: true,
      lastUpdatedAt: new Date().toISOString(),
    });
  };
  const wafPolicy = { persistNeedsBrowser };

  const searchRes = await fetchHtmlWithHttpWafPolicy(
    fetcher,
    effectiveSearch,
    wafPolicy,
  );
  const searchBuf = Buffer.from(searchRes.body, "utf8");
  const searchRef = await evidence.put(searchBuf, {
    adapter: BIZBUYSELL_ADAPTER_ID,
    contentType: "text/html",
    sourceUrl: effectiveSearch,
  });

  const keyer = new BizBuySellDedupKeyer();
  let n = 0;
  for await (const ref of discoverListingRefs(
    searchRes.body,
    effectiveSearch,
  )) {
    if (n >= limit) break;
    const { html, finalUrl } = await fetchListingHtmlWithWafPolicy(
      fetcher,
      ref,
      wafPolicy,
    );
    const detailBuf = Buffer.from(html, "utf8");
    const evRef = await evidence.put(detailBuf, {
      adapter: BIZBUYSELL_ADAPTER_ID,
      contentType: "text/html",
      sourceUrl: finalUrl,
    });
    const parsed = parseListingPage(html, finalUrl);
    const record = buildSourceRecord({
      url: finalUrl,
      adapter: BIZBUYSELL_ADAPTER_ID,
      parsed,
      evidenceRef: evRef,
    });
    const r = await ingestSourceRecord(meta, record, { keyer });
    console.log(`${record.id} -> canonical ${r.canonicalId} (${r.action})`);
    n++;
  }
  console.log(`search evidence: ${searchRef.key} (${searchRef.sha256})`);
}

async function buildFixtureFetcher(): Promise<MockFetcher> {
  const root = join(
    __dirname,
    "..",
    "..",
    "..",
    "packages",
    "scraper",
    "tests",
    "fixtures",
  );
  const search = await readFile(join(root, "bizbuysell-search.html"), "utf8");
  const listingA = await readFile(
    join(root, "bizbuysell-listing-1234567.html"),
    "utf8",
  );
  let listingB: string;
  try {
    listingB = await readFile(
      join(root, "bizbuysell-listing-7654321.html"),
      "utf8",
    );
  } catch {
    listingB = listingA;
  }
  const map = new Map<string, RawResponse>();
  map.set("https://www.bizbuysell.com/businesses-for-sale/", {
    status: 200,
    body: search,
    finalUrl: "https://www.bizbuysell.com/businesses-for-sale/",
    headers: {},
  });
  for (const u of [
    "https://www.bizbuysell.com/california-business-for-sale/1234567/",
    "https://www.bizbuysell.com/florida-business-for-sale/1234567/",
  ]) {
    map.set(u, { status: 200, body: listingA, finalUrl: u, headers: {} });
  }
  map.set("https://www.bizbuysell.com/texas-business-for-sale/7654321/", {
    status: 200,
    body: listingB,
    finalUrl: "https://www.bizbuysell.com/texas-business-for-sale/7654321/",
    headers: {},
  });
  return new MockFetcher(map);
}

async function cmdDealsList(): Promise<void> {
  const meta = new DiskMetadataStore(dataRoot());
  const ids = await meta.listCanonicalIds();
  for (const id of ids.sort()) {
    const d = await meta.getCanonical(id);
    if (!d) continue;
    console.log(
      `${id}\tsources=${d.sourceIds.length}\trep=${d.representativeSourceId}`,
    );
  }
}

async function cmdReplay(): Promise<void> {
  const root = dataRoot();
  const evidence = new DiskEvidenceStore(root);
  const meta = new DiskMetadataStore(root);
  const ids = await meta.listSourceIds();
  for (const sid of ids) {
    const src = await meta.getSource(sid);
    if (!src) continue;
    const parsed = SourceRecordSchema.safeParse(src);
    if (!parsed.success) throw new Error(`invalid source ${sid}`);
    const stream = await evidence.get(parsed.data.evidenceRef);
    const html = await streamToString(stream);
    const again = parseListingPage(html, parsed.data.url);
    const ex0 = parsed.data.externalId;
    const ex1 = again.externalId;
    if (ex0 !== ex1) {
      throw new Error(`replay mismatch ${sid}: externalId ${ex0} vs ${ex1}`);
    }
  }
  console.log(`replay ok (${ids.length} sources)`);
}
