import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFreeDedupModelCacheForTests,
  resolveFreeDedupOpenRouterModel,
} from "../src/openrouter-resolve-dedup-model.js";

describe("resolveFreeDedupOpenRouterModel", () => {
  afterEach(() => {
    clearFreeDedupModelCacheForTests();
    vi.unstubAllGlobals();
  });

  it("prefers DEDUP_FREE_MODEL_PREFERENCES when catalog contains them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "other/zz-instruct:free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                modality: "text->text",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
            {
              id: "google/gemma-4-26b-a4b-it:free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                modality: "text->text",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
          ],
        }),
      })),
    );
    await expect(resolveFreeDedupOpenRouterModel()).resolves.toBe(
      "google/gemma-4-26b-a4b-it:free",
    );
  });

  it("falls back to shortest heuristic :free slug when no preference matches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: "acme/foo-coder:free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                modality: "text->text",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
            {
              id: "acme/bar-coder-extra-long-name:free",
              pricing: { prompt: "0", completion: "0" },
              architecture: {
                modality: "text->text",
                input_modalities: ["text"],
                output_modalities: ["text"],
              },
            },
          ],
        }),
      })),
    );
    await expect(resolveFreeDedupOpenRouterModel()).resolves.toBe(
      "acme/foo-coder:free",
    );
  });
});
