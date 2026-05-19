import { describe, expect, it } from "vitest";
import { processedArtifactKey } from "../src/processed-keys.js";

describe("processedArtifactKey", () => {
  it("uses shared adapter processed kind prefix", () => {
    expect(
      processedArtifactKey(
        "bizbuysell",
        "markdown",
        "abc",
        "text/markdown",
      ),
    ).toBe("shared/bizbuysell/processed/markdown/abc.md");
  });
});
