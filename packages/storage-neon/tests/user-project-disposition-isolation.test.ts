import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NeonMetadataStore, neonMetadataConfigFromEnv } from "../src/index.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
dotenv.config({ path: join(root, ".env.cloud.local") });
dotenv.config({ path: join(root, ".env.dev") });

const config = neonMetadataConfigFromEnv();
const describeNeon = config ? describe : describe.skip;

describeNeon("UserProjectDisposition isolation", () => {
  let store: NeonMetadataStore;
  const workspaceId = `ws-disp-${randomUUID()}`;
  const userU = `usr_u_${randomUUID().replace(/-/g, "")}`;
  const userV = `usr_v_${randomUUID().replace(/-/g, "")}`;
  let projectId: string;

  beforeAll(async () => {
    if (!config) throw new Error("DATABASE_URL not configured");
    store = new NeonMetadataStore(config);
    const project = await store.promoteCanonicalToProject({
      workspaceId,
      createdByUserId: userU,
      canonicalDealId: `deal_${randomUUID()}`,
      title: "Isolation test project",
      addToDealbox: true,
    });
    projectId = project.id;
  });

  afterAll(async () => {
    await store?.disconnect();
  });

  it("dealbox for user U does not appear for user V until V writes their own row", async () => {
    const uDealbox = await store.listUserProjectDispositions({
      userId: userU,
      workspaceId,
      bucket: "dealbox",
    });
    expect(uDealbox.some((d) => d.projectId === projectId)).toBe(true);

    const vDealboxBefore = await store.listUserProjectDispositions({
      userId: userV,
      workspaceId,
      bucket: "dealbox",
    });
    expect(vDealboxBefore.some((d) => d.projectId === projectId)).toBe(false);

    const now = new Date().toISOString();
    await store.putUserProjectDisposition({
      id: randomUUID(),
      userId: userV,
      workspaceId,
      projectId,
      bucket: "anti_dealbox",
      source: "user",
      aiConfidence: null,
      createdAt: now,
      updatedAt: now,
    });

    const vAnti = await store.listUserProjectDispositions({
      userId: userV,
      workspaceId,
      bucket: "anti_dealbox",
    });
    expect(vAnti.some((d) => d.projectId === projectId)).toBe(true);

    const vDealboxAfter = await store.listUserProjectDispositions({
      userId: userV,
      workspaceId,
      bucket: "dealbox",
    });
    expect(vDealboxAfter.some((d) => d.projectId === projectId)).toBe(false);
  });
});
