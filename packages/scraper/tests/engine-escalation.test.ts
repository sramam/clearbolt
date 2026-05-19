import { describe, expect, it } from "vitest";
import { planHttpLaneAfterWaf } from "../src/crawl-policy.js";
import type { WafClass } from "../src/waf-detector.js";

describe("engine escalation", () => {
  it("http_block_routes_to_browser_or_persists", () => {
    const block: WafClass = "block";
    expect(
      planHttpLaneAfterWaf(block, { httpAttemptIndex: 0, maxHttpAttempts: 3 }),
    ).toEqual({
      kind: "persist_needs_browser",
    });
    const challenge: WafClass = "challenge";
    expect(
      planHttpLaneAfterWaf(challenge, {
        httpAttemptIndex: 0,
        maxHttpAttempts: 3,
      }),
    ).toEqual({
      kind: "persist_needs_browser",
    });
  });

  it("rate_limited_retries_then_persists_not_forever", () => {
    expect(
      planHttpLaneAfterWaf("rate_limited", {
        httpAttemptIndex: 0,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "retry_http" });
    expect(
      planHttpLaneAfterWaf("rate_limited", {
        httpAttemptIndex: 1,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "retry_http" });
    expect(
      planHttpLaneAfterWaf("rate_limited", {
        httpAttemptIndex: 2,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "persist_needs_browser" });
    expect(
      planHttpLaneAfterWaf("rate_limited", {
        httpAttemptIndex: 9,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "persist_needs_browser" });
  });

  it("ok_allows_http_lane", () => {
    expect(
      planHttpLaneAfterWaf("ok", { httpAttemptIndex: 0, maxHttpAttempts: 3 }),
    ).toEqual({
      kind: "ok",
    });
  });

  it("hard_denial_does_not_retry_http", async () => {
    const { planHttpLaneAfterWafResponse } = await import(
      "../src/waf-retry-policy.js"
    );
    const body = `Access Denied edgesuite.net errors.edgesuite.net/abc`;
    expect(
      planHttpLaneAfterWafResponse(403, body, {
        httpAttemptIndex: 0,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "fail_hard" });
  });
});
