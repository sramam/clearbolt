import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearDedupEmbedModelCacheForTests,
  resolveDedupEmbedOpenRouterModel,
} from "../src/openrouter-resolve-embed-model.js";

describe("resolveDedupEmbedOpenRouterModel", () => {
  afterEach(() => {
    clearDedupEmbedModelCacheForTests();
    vi.unstubAllGlobals();
  });

  it("prefers DEDUP_FREE_EMBED_MODEL_PREFERENCES when catalog lists it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "nvidia/llama-nemotron-embed-vl-1b-v2:free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["embeddings"],
              },
            },
            {
              id: "cheap/paid",
              pricing: { prompt: "0.000000001", completion: "0" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["embeddings"],
              },
            },
          ],
        }),
      })),
    );
    await expect(resolveDedupEmbedOpenRouterModel()).resolves.toBe(
      "nvidia/llama-nemotron-embed-vl-1b-v2:free",
    );
  });

  it("picks cheapest paid when no free text embedding", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "zebra/big",
              pricing: { prompt: "0.01", completion: "0" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["embeddings"],
              },
            },
            {
              id: "a/nano",
              pricing: { prompt: "0.000000002", completion: "0" },
              architecture: {
                input_modalities: ["text"],
                output_modalities: ["embeddings"],
              },
            },
          ],
        }),
      })),
    );
    await expect(resolveDedupEmbedOpenRouterModel()).resolves.toBe("a/nano");
  });

  it("falls back when embeddings list HTTP fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 500,
      })),
    );
    await expect(resolveDedupEmbedOpenRouterModel()).resolves.toBe(
      "openai/text-embedding-3-small",
    );
  });
});
