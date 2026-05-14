import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DiskEvidenceStore } from "../src/disk-evidence-store.js";

describe("DiskEvidenceStore", () => {
  it("conformance: put, head, get, exists, idempotent put", async () => {
    const tmp = join(
      import.meta.dirname,
      "..",
      ".data-test",
      `ev-${randomBytes(4).toString("hex")}`,
    );
    await mkdir(tmp, { recursive: true });
    const store = new DiskEvidenceStore(tmp);

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

    const stream = await store.get(ref);
    const chunks: Buffer[] = [];
    for await (const c of stream) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    expect(Buffer.concat(chunks).equals(payload)).toBe(true);

    const ref2 = await store.put(payload, meta);
    expect(ref2.sha256).toBe(ref.sha256);

    await rm(tmp, { recursive: true, force: true });
  });
});
