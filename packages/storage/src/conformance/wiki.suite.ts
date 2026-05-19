import { expect } from "vitest";
import type { WikiStore } from "../contracts.js";

/** Shared WikiStore checks (wiki-fs, wiki-r2, …). */
export async function assertWikiStoreConformance(
  store: WikiStore,
): Promise<void> {
  const wsA = "ws-conformance-a";
  const wsB = "ws-conformance-b";

  await store.write(wsA, "deals/example.md", "# hello\n");
  const r = await store.read(wsA, "deals/example.md");
  expect(r?.content).toBe("# hello\n");
  expect(r?.sha256).toMatch(/^[a-f0-9]{64}$/);

  const miss = await store.read(wsB, "deals/example.md");
  expect(miss).toBeNull();

  await store.write(wsA, "index.md", "root");
  await store.write(wsA, "deals/other.md", "x");

  const listed: string[] = [];
  for await (const e of store.list(wsA, "deals/")) {
    listed.push(e.path);
  }
  expect(listed.sort()).toContain("deals/example.md");
  expect(listed.sort()).toContain("deals/other.md");

  if (store.snapshot) {
    const before = await store.read(wsA, "deals/example.md");
    expect(before).not.toBeNull();
    if (before) {
      await store.snapshot(wsA, "deals/example.md", before.sha256);
    }
  }
}
