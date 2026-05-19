import { describe, expect, it } from "vitest";
import { RobotsDisallowedError, beforeCrawlFetch } from "../src/crawl-gate.js";
import { clearRobotsCacheForTests } from "../src/robots-policy.js";

describe("beforeCrawlFetch", () => {
  it("throws when robots disallows path", async () => {
    clearRobotsCacheForTests();
    const url = "https://example.com/forbidden/page";
    await expect(
      beforeCrawlFetch(url, {
        skipRobots: false,
        minGapMs: 0,
        fetchRobots: async () => "User-agent: *\nDisallow: /forbidden\n",
      }),
    ).rejects.toBeInstanceOf(RobotsDisallowedError);
  });

  it("allows when path not listed", async () => {
    clearRobotsCacheForTests();
    await beforeCrawlFetch("https://example.com/ok", {
      minGapMs: 0,
      fetchRobots: async () => "User-agent: *\nDisallow: /forbidden\n",
    });
  });
});
