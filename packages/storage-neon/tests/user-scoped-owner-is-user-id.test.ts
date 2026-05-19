import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AuthError } from "@clearbolt/auth";
import type { UserMarketQuery } from "@clearbolt/core";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NeonMetadataStore, neonMetadataConfigFromEnv } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(root, ".env.cloud.local") });
dotenv.config({ path: join(root, ".env.dev") });

const config = neonMetadataConfigFromEnv();
const describeNeon = config ? describe : describe.skip;

describeNeon("user-scoped owner is internal user id", () => {
  let store: NeonMetadataStore;
  const workspaceId = `ws-test-${randomUUID()}`;
  const userId = `usr_${randomUUID().replace(/-/g, "")}`;
  const queryId = randomUUID();

  beforeAll(async () => {
    if (!config) throw new Error("DATABASE_URL not configured");
    store = new NeonMetadataStore(config);
  });

  afterAll(async () => {
    await store?.disconnect();
  });

  it("rejects email as ownerUserId on write", async () => {
    const now = new Date().toISOString();
    const bad: UserMarketQuery = {
      id: randomUUID(),
      workspaceId,
      ownerUserId: "not-an-id@example.com",
      adapter: "bizbuysell",
      searchUrl: "https://www.bizbuysell.com/test",
      label: null,
      lastRunAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await expect(store.putUserMarketQuery(bad)).rejects.toBeInstanceOf(
      AuthError,
    );
  });

  it("persists and lists queries by internal ownerUserId", async () => {
    const now = new Date().toISOString();
    const query: UserMarketQuery = {
      id: queryId,
      workspaceId,
      ownerUserId: userId,
      adapter: "bizbuysell",
      searchUrl: "https://www.bizbuysell.com/test-list",
      label: "test",
      lastRunAt: null,
      metadata: {},
      createdAt: now,
      updatedAt: now,
    };
    await store.putUserMarketQuery(query);
    const listed = await store.listUserMarketQueries(workspaceId, userId);
    expect(listed.some((q) => q.id === queryId)).toBe(true);
    expect(listed.every((q) => !q.ownerUserId.includes("@"))).toBe(true);
  });
});
