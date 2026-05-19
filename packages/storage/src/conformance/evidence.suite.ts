import { randomBytes } from "node:crypto";
import { expect } from "vitest";
import type { EvidenceStore } from "../contracts.js";

/** Shared EvidenceStore contract checks (disk, R2, …). */
export async function assertEvidenceStoreConformance(
  store: EvidenceStore,
): Promise<void> {
  const payload = Buffer.from(
    `hello-${randomBytes(4).toString("hex")}`,
    "utf8",
  );
  const meta = {
    adapter: "test",
    contentType: "text/plain",
    sourceUrl: "https://example.com/x",
  };

  expect(await store.exists("deadbeef")).toBe(false);

  const ref = await store.put(payload, meta);
  expect(ref.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(await store.exists(ref.sha256)).toBe(true);

  const head = await store.head(ref);
  expect(head.sizeBytes).toBe(payload.length);
  expect(head.sha256).toBe(ref.sha256);

  const stream = await store.get(ref);
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  }
  expect(Buffer.concat(chunks).equals(payload)).toBe(true);

  const ref2 = await store.put(payload, meta);
  expect(ref2.sha256).toBe(ref.sha256);
  expect(ref2.key).toBe(ref.key);
}
