import { describe, expect, it } from "vitest";
import { classifyWaf } from "../src/waf-detector.js";

describe("classifyWaf", () => {
  it("detects 403 as challenge", () => {
    expect(classifyWaf(403, "<html>forbidden</html>")).toBe("challenge");
  });
  it("429 is rate_limited", () => {
    expect(classifyWaf(429, "")).toBe("rate_limited");
  });
});
