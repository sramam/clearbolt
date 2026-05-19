import { describe, expect, it } from "vitest";
import {
  AuthError,
  assertInternalUserId,
  isLikelyEmailUserId,
} from "../src/index.js";

describe("assertInternalUserId", () => {
  it("accepts opaque internal ids", () => {
    expect(() => assertInternalUserId("usr_7f3a9c2b1d4e")).not.toThrow();
  });

  it("rejects email-shaped values", () => {
    expect(() => assertInternalUserId("searcher@example.com")).toThrow(
      AuthError,
    );
    expect(() => assertInternalUserId("searcher@example.com")).toThrow(
      /not an email/i,
    );
  });

  it("rejects empty values", () => {
    expect(() => assertInternalUserId("   ")).toThrow(AuthError);
  });
});

describe("isLikelyEmailUserId", () => {
  it("detects common email forms", () => {
    expect(isLikelyEmailUserId("a@b.co")).toBe(true);
    expect(isLikelyEmailUserId("usr_abc")).toBe(false);
  });
});
