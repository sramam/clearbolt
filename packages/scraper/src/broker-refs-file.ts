import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { normalizeAdapterId } from "./adapter-scoped-paths.js";
import type { BrokerDirectoryRef } from "./broker-directory-ref.js";
import { brokerDirectoryRefFromBizBuySellProfileUrl } from "./broker-directory-ref.js";

export const BROKER_REFS_FILE_VERSION = 1;

export type BrokerRefsFile = {
  version: typeof BROKER_REFS_FILE_VERSION;
  adapter: string;
  directoryUrl: string;
  discoveredAt: string;
  refs: BrokerDirectoryRef[];
  complete?: boolean;
  pagesFetched?: number;
  lastPageUrl?: string;
  nextPageUrl?: string;
};

export function isBrokerDiscoveryComplete(file: BrokerRefsFile): boolean {
  return file.complete !== false;
}

export type WriteBrokerRefsPayload = Omit<
  BrokerRefsFile,
  "version" | "discoveredAt" | "refs" | "adapter"
> & {
  adapter?: string;
  discoveredAt?: string;
  refs: BrokerDirectoryRef[];
  complete?: boolean;
};

export function resolveBrokerRefsPath(filePath: string): string {
  return resolve(process.cwd(), filePath);
}

function normalizeBrokerRefs(refs: BrokerDirectoryRef[]): BrokerDirectoryRef[] {
  const out: BrokerDirectoryRef[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = brokerDirectoryRefFromBizBuySellProfileUrl(ref.profileUrl, {
      name: ref.name,
      firm: ref.firm,
      state: ref.state,
    });
    const profileUrl = parsed?.profileUrl ?? ref.profileUrl;
    const key = parsed?.externalBrokerId ?? ref.externalBrokerId ?? profileUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      ...ref,
      profileUrl,
      externalBrokerId: parsed?.externalBrokerId ?? ref.externalBrokerId,
      sourceAdapter: ref.sourceAdapter || parsed?.sourceAdapter || "bizbuysell",
    });
  }
  return out;
}

function assertBrokerRefsWritePath(filePath: string, adapter: string): void {
  const resolved = resolveBrokerRefsPath(filePath);
  const root = `${sep}broker-refs${sep}`;
  if (!resolved.includes(root)) return;
  const scoped = `${root}${normalizeAdapterId(adapter)}${sep}`;
  if (!resolved.includes(scoped)) {
    throw new Error(
      `Broker refs must be written under broker-refs/${normalizeAdapterId(adapter)}/ (got ${filePath})`,
    );
  }
}

export async function writeBrokerRefsFile(
  filePath: string,
  payload: WriteBrokerRefsPayload,
): Promise<void> {
  const complete = payload.complete ?? true;
  const adapter = payload.adapter ?? "bizbuysell";
  assertBrokerRefsWritePath(filePath, adapter);
  const body: BrokerRefsFile = {
    version: BROKER_REFS_FILE_VERSION,
    adapter,
    directoryUrl: payload.directoryUrl,
    discoveredAt: payload.discoveredAt ?? new Date().toISOString(),
    refs: normalizeBrokerRefs(payload.refs),
    complete,
    ...(payload.pagesFetched !== undefined
      ? { pagesFetched: payload.pagesFetched }
      : {}),
    ...(payload.lastPageUrl ? { lastPageUrl: payload.lastPageUrl } : {}),
    ...(payload.nextPageUrl && !complete
      ? { nextPageUrl: payload.nextPageUrl }
      : {}),
  };
  const path = resolveBrokerRefsPath(filePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(body, null, 2), "utf8");
}

export async function readBrokerRefsFile(
  filePath: string,
): Promise<BrokerRefsFile> {
  const raw = await readFile(resolveBrokerRefsPath(filePath), "utf8");
  const data = JSON.parse(raw) as BrokerRefsFile;
  if (data.version !== BROKER_REFS_FILE_VERSION) {
    throw new Error(
      `Unsupported broker refs file version ${String(data.version)} (expected ${BROKER_REFS_FILE_VERSION})`,
    );
  }
  if (!data.directoryUrl?.trim()) {
    throw new Error("Broker refs file missing directoryUrl");
  }
  if (!Array.isArray(data.refs)) {
    throw new Error("Broker refs file missing refs array");
  }
  const adapter = data.adapter?.trim() || "bizbuysell";
  return {
    ...data,
    adapter,
    refs: normalizeBrokerRefs(data.refs),
  };
}
