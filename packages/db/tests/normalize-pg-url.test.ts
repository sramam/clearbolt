import { describe, expect, it } from "vitest";
import { normalizePgDatabaseUrl } from "../src/config.js";

describe("normalizePgDatabaseUrl", () => {
  it("appends uselibpqcompat for sslmode=require", () => {
    const u =
      "postgresql://u:p@host/db?sslmode=require&channel_binding=require";
    const out = normalizePgDatabaseUrl(u);
    expect(out).toContain("uselibpqcompat=true");
    expect(out).toContain("sslmode=require");
  });

  it("is idempotent", () => {
    const u =
      "postgresql://u:p@host/db?sslmode=require&channel_binding=require";
    const once = normalizePgDatabaseUrl(u);
    expect(normalizePgDatabaseUrl(once)).toBe(once);
  });

  it("does not alter verify-full", () => {
    const u = "postgresql://u:p@host/db?sslmode=verify-full";
    expect(normalizePgDatabaseUrl(u)).toBe(u);
  });
});
