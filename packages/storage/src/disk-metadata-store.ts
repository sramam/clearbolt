import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  SourceRecord,
} from "@clearbolt/core";
import type { MetadataStore } from "./contracts.js";
import { dedupKeyAdapter } from "./adapter-partition.js";
import { dedupKeyHash, hostFileName } from "./dedup-index.js";

export class DiskMetadataStore implements MetadataStore {
  constructor(private readonly rootDir: string) {}

  private sourcesRoot() {
    return join(this.rootDir, "sources");
  }

  private sourceDir(adapter: string) {
    return join(this.sourcesRoot(), adapter);
  }

  private dealsRoot() {
    return join(this.rootDir, "deals");
  }

  private dealDir(adapter: string) {
    return join(this.dealsRoot(), adapter);
  }

  private indexDir(adapter: string) {
    return join(this.rootDir, "index", adapter);
  }

  private indexPath(adapter: string) {
    return join(this.indexDir(adapter), "dedup.json");
  }

  private domainDir() {
    return join(this.rootDir, "domain");
  }

  private async readDedupMap(adapter: string): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.indexPath(adapter), "utf8");
      return JSON.parse(raw) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private async writeDedupMap(
    adapter: string,
    m: Record<string, string>,
  ): Promise<void> {
    const path = this.indexPath(adapter);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(m, null, 2), "utf8");
  }

  private async listAdapterDirs(root: string): Promise<string[]> {
    try {
      const entries = await readdir(root, { withFileTypes: true });
      return entries.filter((e) => e.isDirectory()).map((e) => e.name);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return [];
      throw err;
    }
  }

  async putSource(record: SourceRecord): Promise<void> {
    const dir = this.sourceDir(record.adapter);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${record.id}.json`),
      JSON.stringify(record, null, 2),
      "utf8",
    );
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    for (const adapter of await this.listAdapterDirs(this.sourcesRoot())) {
      try {
        const raw = await readFile(
          join(this.sourceDir(adapter), `${id}.json`),
          "utf8",
        );
        return JSON.parse(raw) as SourceRecord;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
    try {
      const raw = await readFile(join(this.sourcesRoot(), `${id}.json`), "utf8");
      return JSON.parse(raw) as SourceRecord;
    } catch {
      return null;
    }
  }

  async listSourceIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const adapter of await this.listAdapterDirs(this.sourcesRoot())) {
      try {
        const files = await readdir(this.sourceDir(adapter));
        for (const f of files) {
          if (f.endsWith(".json")) ids.add(f.replace(/\.json$/, ""));
        }
      } catch {
        /* skip */
      }
    }
    try {
      const legacy = await readdir(this.sourcesRoot());
      for (const f of legacy) {
        if (f.endsWith(".json")) ids.add(f.replace(/\.json$/, ""));
      }
    } catch {
      /* no legacy flat dir */
    }
    return [...ids];
  }

  async putCanonical(deal: CanonicalDeal): Promise<void> {
    const rep = await this.getSource(deal.representativeSourceId);
    if (!rep?.adapter) {
      throw new Error(
        `putCanonical: missing representative source ${deal.representativeSourceId}`,
      );
    }
    const dir = this.dealDir(rep.adapter);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `${deal.id}.json`),
      JSON.stringify(deal, null, 2),
      "utf8",
    );
  }

  async getCanonical(id: string): Promise<CanonicalDeal | null> {
    for (const adapter of await this.listAdapterDirs(this.dealsRoot())) {
      try {
        const raw = await readFile(
          join(this.dealDir(adapter), `${id}.json`),
          "utf8",
        );
        return JSON.parse(raw) as CanonicalDeal;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== "ENOENT") throw err;
      }
    }
    try {
      const raw = await readFile(join(this.dealsRoot(), `${id}.json`), "utf8");
      return JSON.parse(raw) as CanonicalDeal;
    } catch {
      return null;
    }
  }

  async listCanonicalIds(): Promise<string[]> {
    const ids = new Set<string>();
    for (const adapter of await this.listAdapterDirs(this.dealsRoot())) {
      try {
        const files = await readdir(this.dealDir(adapter));
        for (const f of files) {
          if (f.endsWith(".json")) ids.add(f.replace(/\.json$/, ""));
        }
      } catch {
        /* skip */
      }
    }
    try {
      const entries = await readdir(this.dealsRoot(), { withFileTypes: true });
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith(".json")) {
          ids.add(e.name.replace(/\.json$/, ""));
        }
      }
    } catch {
      /* no deals dir */
    }
    return [...ids];
  }

  async getCanonicalIdForDedupKey(key: DedupKey): Promise<string | null> {
    const adapter = dedupKeyAdapter(key);
    const m = await this.readDedupMap(adapter);
    return m[dedupKeyHash(key)] ?? null;
  }

  async setDedupMapping(key: DedupKey, canonicalId: string): Promise<void> {
    const adapter = dedupKeyAdapter(key);
    const m = await this.readDedupMap(adapter);
    m[dedupKeyHash(key)] = canonicalId;
    await this.writeDedupMap(adapter, m);
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
