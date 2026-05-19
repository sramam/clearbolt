import { randomUUID } from "node:crypto";
import { assertInternalUserId } from "@clearbolt/auth";
import type {
  DispositionBucket,
  UserMarketQuery,
  UserProjectDisposition,
  WorkspaceProject,
  WorkspaceProjectStatus,
} from "@clearbolt/core";
import type { PrismaClient } from "@clearbolt/db";
import type { WorkspacePipelineStore } from "@clearbolt/storage";

function toJson<T>(value: T): object {
  return JSON.parse(JSON.stringify(value)) as object;
}

function iso(d: Date): string {
  return d.toISOString();
}

function rowToProject(row: {
  id: string;
  workspaceId: string;
  createdByUserId: string;
  title: string;
  canonicalDealId: string | null;
  status: string;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): WorkspaceProject {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    createdByUserId: row.createdByUserId,
    title: row.title,
    canonicalDealId: row.canonicalDealId,
    status: row.status as WorkspaceProjectStatus,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function rowToMarketQuery(row: {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  adapter: string;
  searchUrl: string;
  label: string | null;
  lastRunAt: Date | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): UserMarketQuery {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    ownerUserId: row.ownerUserId,
    adapter: row.adapter,
    searchUrl: row.searchUrl,
    label: row.label,
    lastRunAt: row.lastRunAt ? iso(row.lastRunAt) : null,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function rowToDisposition(row: {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  bucket: string;
  source: string;
  aiConfidence: number | null;
  createdAt: Date;
  updatedAt: Date;
}): UserProjectDisposition {
  return {
    id: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    bucket: row.bucket as DispositionBucket,
    source: row.source as UserProjectDisposition["source"],
    aiConfidence: row.aiConfidence,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

export function createWorkspacePipelineStore(
  prisma: PrismaClient,
): WorkspacePipelineStore {
  return {
    async putWorkspaceProject(project) {
      assertInternalUserId(project.createdByUserId, "createdByUserId");
      await prisma.workspaceProjectRow.upsert({
        where: { id: project.id },
        create: {
          id: project.id,
          workspaceId: project.workspaceId,
          createdByUserId: project.createdByUserId,
          title: project.title,
          canonicalDealId: project.canonicalDealId,
          status: project.status,
          metadata: toJson(project.metadata),
        },
        update: {
          title: project.title,
          canonicalDealId: project.canonicalDealId,
          status: project.status,
          metadata: toJson(project.metadata),
        },
      });
    },

    async getWorkspaceProject(id, workspaceId) {
      const row = await prisma.workspaceProjectRow.findFirst({
        where: { id, workspaceId },
      });
      return row ? rowToProject(row) : null;
    },

    async listWorkspaceProjects(workspaceId) {
      const rows = await prisma.workspaceProjectRow.findMany({
        where: { workspaceId },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map(rowToProject);
    },

    async putUserMarketQuery(query) {
      assertInternalUserId(query.ownerUserId, "ownerUserId");
      await prisma.userMarketQueryRow.upsert({
        where: { id: query.id },
        create: {
          id: query.id,
          workspaceId: query.workspaceId,
          ownerUserId: query.ownerUserId,
          adapter: query.adapter,
          searchUrl: query.searchUrl,
          label: query.label,
          lastRunAt: query.lastRunAt ? new Date(query.lastRunAt) : null,
          metadata: toJson(query.metadata),
        },
        update: {
          adapter: query.adapter,
          searchUrl: query.searchUrl,
          label: query.label,
          lastRunAt: query.lastRunAt ? new Date(query.lastRunAt) : null,
          metadata: toJson(query.metadata),
        },
      });
    },

    async getUserMarketQuery(id, workspaceId) {
      const row = await prisma.userMarketQueryRow.findFirst({
        where: { id, workspaceId },
      });
      return row ? rowToMarketQuery(row) : null;
    },

    async listUserMarketQueries(workspaceId, ownerUserId) {
      assertInternalUserId(ownerUserId, "ownerUserId");
      const rows = await prisma.userMarketQueryRow.findMany({
        where: { workspaceId, ownerUserId },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map(rowToMarketQuery);
    },

    async putUserProjectDisposition(disposition) {
      assertInternalUserId(disposition.userId, "userId");
      await prisma.userProjectDispositionRow.upsert({
        where: {
          userId_projectId: {
            userId: disposition.userId,
            projectId: disposition.projectId,
          },
        },
        create: {
          id: disposition.id,
          userId: disposition.userId,
          workspaceId: disposition.workspaceId,
          projectId: disposition.projectId,
          bucket: disposition.bucket,
          source: disposition.source,
          aiConfidence: disposition.aiConfidence,
        },
        update: {
          bucket: disposition.bucket,
          source: disposition.source,
          aiConfidence: disposition.aiConfidence,
          workspaceId: disposition.workspaceId,
        },
      });
    },

    async getUserProjectDisposition(userId, projectId) {
      assertInternalUserId(userId, "userId");
      const row = await prisma.userProjectDispositionRow.findUnique({
        where: { userId_projectId: { userId, projectId } },
      });
      return row ? rowToDisposition(row) : null;
    },

    async listUserProjectDispositions({ userId, workspaceId, bucket }) {
      assertInternalUserId(userId, "userId");
      const rows = await prisma.userProjectDispositionRow.findMany({
        where: {
          userId,
          workspaceId,
          ...(bucket ? { bucket } : {}),
        },
        orderBy: { updatedAt: "desc" },
      });
      return rows.map(rowToDisposition);
    },

    async promoteCanonicalToProject(input) {
      assertInternalUserId(input.createdByUserId, "createdByUserId");
      const now = new Date().toISOString();
      const projectId = randomUUID();
      const project: WorkspaceProject = {
        id: projectId,
        workspaceId: input.workspaceId,
        createdByUserId: input.createdByUserId,
        title: input.title,
        canonicalDealId: input.canonicalDealId,
        status: "researching",
        metadata: {
          researchStatus: "pending",
          promotedAt: now,
        },
        createdAt: now,
        updatedAt: now,
      };
      await prisma.workspaceProjectRow.create({
        data: {
          id: project.id,
          workspaceId: project.workspaceId,
          createdByUserId: project.createdByUserId,
          title: project.title,
          canonicalDealId: project.canonicalDealId,
          status: project.status,
          metadata: toJson(project.metadata),
        },
      });
      if (input.addToDealbox !== false) {
        const disposition: UserProjectDisposition = {
          id: randomUUID(),
          userId: input.createdByUserId,
          workspaceId: input.workspaceId,
          projectId,
          bucket: "dealbox",
          source: "user",
          aiConfidence: null,
          createdAt: now,
          updatedAt: now,
        };
        await prisma.userProjectDispositionRow.create({
          data: {
            id: disposition.id,
            userId: disposition.userId,
            workspaceId: disposition.workspaceId,
            projectId: disposition.projectId,
            bucket: disposition.bucket,
            source: disposition.source,
            aiConfidence: disposition.aiConfidence,
          },
        });
      }
      return project;
    },
  };
}
