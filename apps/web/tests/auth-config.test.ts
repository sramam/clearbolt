import { describe, expect, it } from "vitest";
import { hasDevAuthBypass, isBetterAuthConfigured } from "../lib/auth-config";

describe("auth-config", () => {
  it("detects configured better-auth env", () => {
    expect(
      isBetterAuthConfigured({
        DATABASE_URL: "postgresql://localhost/db",
        BETTER_AUTH_SECRET: "x".repeat(32),
      }),
    ).toBe(true);
  });

  it("dev bypass only when auth is not configured", () => {
    expect(
      hasDevAuthBypass({
        CLEARBOLT_DEV_USER_ID: "usr_dev",
        DATABASE_URL: undefined,
        BETTER_AUTH_SECRET: undefined,
      }),
    ).toBe(true);
    expect(
      hasDevAuthBypass({
        CLEARBOLT_DEV_USER_ID: "usr_dev",
        DATABASE_URL: "postgresql://localhost/db",
        BETTER_AUTH_SECRET: "x".repeat(32),
      }),
    ).toBe(false);
  });
});
