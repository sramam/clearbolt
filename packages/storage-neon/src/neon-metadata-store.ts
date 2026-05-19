import type {
  CanonicalDeal,
  DedupKey,
  DomainProfile,
  SourceRecord,
} from "@clearbolt/core";
import { normalizePgDatabaseUrl } from "@clearbolt/db";
import type { DatabaseConfig as NeonMetadataStoreConfig } from "@clearbolt/db";
import { PrismaClient } from "@clearbolt/db";
import {
  type MetadataStore,
  type WorkspacePipelineStore,
  dedupKeyHash,
  hostFileName,
} from "@clearbolt/storage";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import {
  reindexAllDealSearch,
  upsertDealSearchIndex,
} from "./deal-search-index.js";
import { createWorkspacePipelineStore } from "./workspace-pipeline.js";

function toJson<T>(value: T): object {
  return JSON.parse(JSON.stringify(value)) as object;
}

function isDealSearchIndexUnavailable(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("deal_search_index");
}

type PrismaDelegate = InstanceType<typeof PrismaClient>;

export class NeonMetadataStore
  implements MetadataStore, WorkspacePipelineStore
{
  private readonly prisma: PrismaDelegate;
  private readonly pool: Pool;
  private readonly pipeline: WorkspacePipelineStore;

  constructor(config: NeonMetadataStoreConfig) {
    this.pool = new Pool({
      connectionString: normalizePgDatabaseUrl(config.databaseUrl),
    });
    const adapter = new PrismaPg(this.pool);
    this.prisma = new PrismaClient({ adapter });
    this.pipeline = createWorkspacePipelineStore(this.prisma);
  }

  putWorkspaceProject = (
    ...args: Parameters<WorkspacePipelineStore["putWorkspaceProject"]>
  ) => this.pipeline.putWorkspaceProject(...args);

  getWorkspaceProject = (
    ...args: Parameters<WorkspacePipelineStore["getWorkspaceProject"]>
  ) => this.pipeline.getWorkspaceProject(...args);

  listWorkspaceProjects = (
    ...args: Parameters<WorkspacePipelineStore["listWorkspaceProjects"]>
  ) => this.pipeline.listWorkspaceProjects(...args);

  putUserMarketQuery = (
    ...args: Parameters<WorkspacePipelineStore["putUserMarketQuery"]>
  ) => this.pipeline.putUserMarketQuery(...args);

  getUserMarketQuery = (
    ...args: Parameters<WorkspacePipelineStore["getUserMarketQuery"]>
  ) => this.pipeline.getUserMarketQuery(...args);

  listUserMarketQueries = (
    ...args: Parameters<WorkspacePipelineStore["listUserMarketQueries"]>
  ) => this.pipeline.listUserMarketQueries(...args);

  putUserProjectDisposition = (
    ...args: Parameters<WorkspacePipelineStore["putUserProjectDisposition"]>
  ) => this.pipeline.putUserProjectDisposition(...args);

  getUserProjectDisposition = (
    ...args: Parameters<WorkspacePipelineStore["getUserProjectDisposition"]>
  ) => this.pipeline.getUserProjectDisposition(...args);

  listUserProjectDispositions = (
    ...args: Parameters<WorkspacePipelineStore["listUserProjectDispositions"]>
  ) => this.pipeline.listUserProjectDispositions(...args);

  promoteCanonicalToProject = (
    ...args: Parameters<WorkspacePipelineStore["promoteCanonicalToProject"]>
  ) => this.pipeline.promoteCanonicalToProject(...args);

  async disconnect(): Promise<void> {
    await this.prisma.$disconnect();
    await this.pool.end();
  }

  async putSource(record: SourceRecord): Promise<void> {
    await this.prisma.sourceRecordRow.upsert({
      where: { id: record.id },
      create: { id: record.id, payload: toJson(record) },
      update: { payload: toJson(record) },
    });
  }

  async getSource(id: string): Promise<SourceRecord | null> {
    const row = await this.prisma.sourceRecordRow.findUnique({ where: { id } });
    return row ? (row.payload as SourceRecord) : null;
  }

  async listSourceIds(): Promise<string[]> {
    const rows = await this.prisma.sourceRecordRow.findMany({
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async putCanonical(deal: CanonicalDeal): Promise<void> {
    await this.prisma.canonicalDealRow.upsert({
      where: { id: deal.id },
      create: { id: deal.id, payload: toJson(deal) },
      update: { payload: toJson(deal) },
    });
    await this.refreshDealSearchIndex(deal.id);
  }

  /** Rebuild FTS row for one canonical deal from current sources. */
  async refreshDealSearchIndex(canonicalId: string): Promise<void> {
    const deal = await this.getCanonical(canonicalId);
    if (!deal) return;
    const sources: SourceRecord[] = [];
    for (const sid of deal.sourceIds) {
      const s = await this.getSource(sid);
      if (s) sources.push(s);
    }
    try {
      await upsertDealSearchIndex(this.prisma, deal, sources);
    } catch (err) {
      if (!isDealSearchIndexUnavailable(err)) throw err;
    }
  }

  /** Postgres pool (FTS / raw SQL). */
  pgPool(): Pool {
    return this.pool;
  }

  /** Backfill `deal_search_index` from all canonical deals. */
  async reindexAllDealSearch(): Promise<number> {
    return reindexAllDealSearch(
      this.prisma,
      () => this.listCanonicalIds(),
      (id) => this.getCanonical(id),
      (id) => this.getSource(id),
    );
  }

  async getCanonical(id: string): Promise<CanonicalDeal | null> {
    const row = await this.prisma.canonicalDealRow.findUnique({
      where: { id },
    });
    return row ? (row.payload as CanonicalDeal) : null;
  }

  async listCanonicalIds(): Promise<string[]> {
    const rows = await this.prisma.canonicalDealRow.findMany({
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async getCanonicalIdForDedupKey(key: DedupKey): Promise<string | null> {
    const hash = dedupKeyHash(key);
    const row = await this.prisma.dedupMappingRow.findUnique({
      where: { keyHash: hash },
    });
    return row?.canonicalId ?? null;
  }

  async setDedupMapping(key: DedupKey, canonicalId: string): Promise<void> {
    const keyHash = dedupKeyHash(key);
    await this.prisma.dedupMappingRow.upsert({
      where: { keyHash },
      create: { keyHash, canonicalId },
      update: { canonicalId },
    });
  }

  async getDomainProfile(host: string): Promise<DomainProfile | null> {
    const row = await this.prisma.domainProfileRow.findUnique({
      where: { host: hostFileName(host) },
    });
    return row ? (row.payload as DomainProfile) : null;
  }

  async putDomainProfile(profile: DomainProfile): Promise<void> {
    const host = hostFileName(profile.host);
    await this.prisma.domainProfileRow.upsert({
      where: { host },
      create: { host, payload: toJson(profile) },
      update: { payload: toJson(profile) },
    });
  }
}
