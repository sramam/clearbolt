import { afterEach, describe, expect, it } from "vitest";
import { openBrowserSession } from "../src/browser-fetcher.js";

describe("openBrowserSession", () => {
  afterEach(() => {
    process.env.CLEARBOLT_SKIP_BROWSER = undefined;
  });

  it("returns_null_when_CLEARBOLT_SKIP_BROWSER", async () => {
    process.env.CLEARBOLT_SKIP_BROWSER = "1";
    const session = await openBrowserSession();
    expect(session).toBeNull();
  });
});
