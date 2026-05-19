import { describe, expect, it } from "vitest";
import type { ClearboltClaims } from "../src/index.js";
import { AuthError } from "../src/index.js";

describe("@clearbolt/auth scaffold", () => {
  it("exports claim and error types", () => {
    const _claims: ClearboltClaims = {
      userId: "u",
      workspaceId: "w",
      workspaceRole: "member",
      iat: 0,
      exp: 1,
    };
    expect(_claims.workspaceId).toBe("w");
    const err = new AuthError("unimplemented", "not wired");
    expect(err.code).toBe("unimplemented");
  });
});
