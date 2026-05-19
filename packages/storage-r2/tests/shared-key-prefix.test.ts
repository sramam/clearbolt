import { describe, expect, it } from "vitest";
import { sharedEvidenceKey, workspaceEvidenceKey } from "../src/keys.js";

describe("sharedEvidenceKey", () => {
  it("uses shared adapter sha256 prefix", () => {
    expect(sharedEvidenceKey("bizbuysell", "a".repeat(64), "text/html")).toBe(
      `shared/bizbuysell/${"a".repeat(64)}.html`,
    );
  });

  it("uses json extension for json content types", () => {
    expect(
      sharedEvidenceKey("bizbuysell", "b".repeat(64), "application/json"),
    ).toBe(`shared/bizbuysell/${"b".repeat(64)}.json`);
  });
});

describe("workspaceEvidenceKey", () => {
  it("uses workspaces workspaceId subArea prefix", () => {
    expect(
      workspaceEvidenceKey("ws-1", "captures", "c".repeat(64), "text/html"),
    ).toBe(`workspaces/ws-1/captures/${"c".repeat(64)}.html`);
  });
});
