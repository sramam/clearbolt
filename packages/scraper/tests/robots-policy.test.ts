import { describe, expect, it } from "vitest";
import {
  crawlDelayMsFromRobots,
  isPathAllowed,
  isUrlAllowedByRobots,
  parseRobotsTxt,
} from "../src/robots-policy.js";

describe("parseRobotsTxt", () => {
  it("disallows_private_prefix", () => {
    const parsed = parseRobotsTxt(
      "User-agent: *\nDisallow: /private\nAllow: /public\n",
    );
    expect(isPathAllowed("/private/secret", parsed)).toBe(false);
    expect(isPathAllowed("/public/page", parsed)).toBe(true);
  });

  it("reads_crawl_delay", () => {
    const parsed = parseRobotsTxt(
      "User-agent: *\nCrawl-delay: 2.5\nDisallow:\n",
    );
    expect(crawlDelayMsFromRobots(parsed)).toBe(2500);
  });

  it("isUrlAllowedByRobots respects pathname", () => {
    const parsed = parseRobotsTxt("User-agent: *\nDisallow: /admin\n");
    expect(
      isUrlAllowedByRobots("https://example.com/admin/settings", parsed),
    ).toBe(false);
    expect(isUrlAllowedByRobots("https://example.com/about", parsed)).toBe(
      true,
    );
  });
});
