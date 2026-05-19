import { afterEach, describe, expect, it, vi } from "vitest";
import {
  embedTextOpenRouter,
  embedTextsOpenRouter,
} from "../src/openrouter-embed.js";

describe("openrouter-embed", () => {
  const origKey = process.env.OPENROUTER_API_KEY;
  const origModel = process.env.CLEARBOLT_DEDUP_EMBED_MODEL;

  afterEach(() => {
    if (origKey !== undefined) process.env.OPENROUTER_API_KEY = origKey;
    else process.env.OPENROUTER_API_KEY = undefined;
    if (origModel !== undefined)
      process.env.CLEARBOLT_DEDUP_EMBED_MODEL = origModel;
    else process.env.CLEARBOLT_DEDUP_EMBED_MODEL = undefined;
    vi.unstubAllGlobals();
  });

  it("returns null when OPENROUTER_API_KEY is empty", async () => {
    process.env.OPENROUTER_API_KEY = "";
    await expect(embedTextOpenRouter("hello")).resolves.toBeNull();
  });

  it("parses embedding response", async () => {
    process.env.OPENROUTER_API_KEY = "k";
    process.env.CLEARBOLT_DEDUP_EMBED_MODEL = "test/embed";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
        }),
      })),
    );
    const batch = await embedTextsOpenRouter(["a", "b"]);
    expect(batch).toEqual([
      [1, 0],
      [0, 1],
    ]);
  });
});
