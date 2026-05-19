import { DiskProcessedArtifactStore } from "@clearbolt/storage";
import { describe, expect, it } from "vitest";
import {
  buildStructuredListingJson,
  htmlToListingMarkdown,
  persistListingProcessedArtifacts,
} from "../src/listing-artifacts.js";

describe("listing artifacts", () => {
  it("builds markdown from html", () => {
    const md = htmlToListingMarkdown(
      "<html><body><h1>Pool Co</h1><p>Great business</p></body></html>",
      { title: "Pool Co", url: "https://example.com/1" },
    );
    expect(md).toContain("# Pool Co");
    expect(md).toContain("great business");
  });

  it("persists processed artifacts to disk store", async () => {
    const store = new DiskProcessedArtifactStore(
      `/tmp/clearbolt-artifact-test-${Date.now()}`,
    );
    const refs = await persistListingProcessedArtifacts(store, {
      adapter: "bizbuysell",
      sourceUrl: "https://www.bizbuysell.com/x/1234567/",
      rawEvidenceSha256: "abc123",
      html: "<p>Test listing body</p>",
      parsed: { title: "Test", askingPrice: 100_000, state: "CA" },
      bodyEmbedding: [0.1, 0.2],
      bodyEmbeddingModel: "test-model",
    });
    expect(refs.markdown?.key).toContain("processed/bizbuysell/markdown");
    expect(refs.structured?.key).toContain("structured");
    expect(refs.embedding?.key).toContain("embedding");
    expect(refs.classification?.key).toContain("classification");

    const structuredKey = refs.structured;
    expect(structuredKey).toBeDefined();
    if (!structuredKey) return;
    const structured = await store.get(structuredKey);
    const chunks: Buffer[] = [];
    for await (const c of structured) {
      chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    }
    const json = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      fields: { title?: string };
    };
    expect(json.fields.title).toBe("Test");
  });

  it("structured json links to raw evidence", () => {
    const doc = buildStructuredListingJson({
      adapter: "bizbuysell",
      sourceUrl: "https://x",
      rawEvidenceSha256: "deadbeef",
      html: "",
      parsed: { title: "A" },
    });
    expect(doc.derivedFromEvidenceSha256).toBe("deadbeef");
  });
});
