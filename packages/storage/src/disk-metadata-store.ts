import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  SourceRecord,
} from "@clearbolt/core";
import type { MetadataStore } from "./contracts.js";

function stableDedupKeyJson(key: DedupKey): string {
  return JSON.stringify(key);
}

function dedupKeyHash(key: DedupKey): string {
  return createHash("sha256").update(stableDedupKeyJson(key)).digest("hex");
}

function hostFileName(host: string): string {
  return host.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}

export class DiskMetadataStore implements MetadataStore {
  constructor(private readonly rootDir: string) {}

  private sourcesDir() {
    return join(this.rootDir, "sources");
  }

  private dealsDir() {
    return join(this.rootDir, "deals");
  }

  private indexPath() {
    return join(this.rootDir, "index", "dedup.json");
  }

  private domainDir() {
    return join(this.rootDir, "domain");
  }

  private async readDedupMap(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.indexPath(), "utf8");
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeDedupMap(m: Record<string, string>): Promise<void> {
    await mkdir(dirname(this.indexPath()), { recursive: true });
    await writeFile(this.indexPath(), JSON.stringify(m, null, 2), "utf8");
  }

  async putSource(record: SourceRecord): Promise<void> {
    const dir = this.sourcesDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    try {
      const raw = await readFile(join(this.sourcesDir(), `${id}.json`), "utf8");
      return JSON.parse(raw) as SourceRecord;
    } catch {
      return null;
    }
  }

  async listSourceIds(): Promise<string[]> {
    try {
      const dir = this.sourcesDir();
      const files = await readdir(dir);
      return files
        .filter((f: string) => f.endsWith(".json"))
        .map((f: string) => f.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }

  async putCanonical(deal: CanonicalDeal): Promise<void> {
    const dir = this.dealsDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${deal.id}.json`),
      JSON.stringify(deal, null, 2),
      "utf8",
    );
  }

  async getCanonical(id: string): Promise<CanonicalDeal | null> {
    try {
      const raw = await readFile(join(this.dealsDir(), `${id}.json`), "utf8");
      return JSON.parse(raw) as CanonicalDeal;
    } catch {
      return null;
    }
  }

  async listCanonicalIds(): Promise<string[]> {
    try {
      const files = await readdir(this.dealsDir());
      return files
        .filter((f: string) => f.endsWith(".json"))
        .map((f: string) => f.replace(/\.json$/, ""));
    } catch {
      return [];
    }
  }

  async getCanonicalIdForDedupKey(key: DedupKey): Promise<string | null> {
    const m = await this.readDedupMap();
    return m[dedupKeyHash(key)] ?? null;
  }

  async setDedupMapping(key: DedupKey, canonicalId: string): Promise<void> {
    const m = await this.readDedupMap();
    m[dedupKeyHash(key)] = canonicalId;
    await this.writeDedupMap(m);
  }

  async getDomainProfile(host: string): Promise<DomainProfile | null> {
    try {
      const raw = await readFile(
        join(this.domainDir(), `${hostFileName(host)}.json`),
        "utf8",
      );
      return JSON.parse(raw) as DomainProfile;
    } catch {
      return null;
    }
  }

  async putDomainProfile(profile: DomainProfile): Promise<void> {
    const dir = this.domainDir();
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${hostFileName(profile.host)}.json`),
      JSON.stringify(profile, null, 2),
      "utf8",
    );
  }
}
