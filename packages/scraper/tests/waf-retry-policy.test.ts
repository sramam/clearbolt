import { describe, expect, it } from "vitest";
import {
  akamaiHardBlockProxyRetryAttempts,
  isHardAkamaiDenial,
  planHttpLaneAfterWafResponse,
  resolveWafMaxAttempts,
  shouldRetryBrowserWafFetch,
} from "../src/waf-retry-policy.js";

const ACCESS_DENIED = `<html><title>Access Denied</title>
You don't have permission to access on this server.
Reference #18.9e97c017.1779038724.4084e44
https://errors.edgesuite.net/18.9e97c017.1779038724.4084e44</html>`;

describe("waf-retry-policy", () => {
  it("detects Akamai hard denial", () => {
    expect(isHardAkamaiDenial(ACCESS_DENIED)).toBe(true);
    expect(isHardAkamaiDenial("<html>ok listing body</html>")).toBe(false);
  });

  it("hard denial fails fast on HTTP lane", () => {
    expect(
      planHttpLaneAfterWafResponse(403, ACCESS_DENIED, {
        httpAttemptIndex: 0,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "fail_hard" });
  });

  it("rate limits retry up to max attempts", () => {
    expect(
      planHttpLaneAfterWafResponse(429, "slow down", {
        httpAttemptIndex: 0,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "retry_http" });
    expect(
      planHttpLaneAfterWafResponse(429, "slow down", {
        httpAttemptIndex: 2,
        maxHttpAttempts: 3,
      }),
    ).toEqual({ kind: "persist_needs_browser" });
  });

  it("browser lane does not retry hard denial", () => {
    expect(
      shouldRetryBrowserWafFetch(403, ACCESS_DENIED, 0, 3),
    ).toBe(false);
    expect(
      shouldRetryBrowserWafFetch(403, "<html>thin akamai</html>", 0, 3),
    ).toBe(true);
  });

  it("resolveWafMaxAttempts defaults to 3", () => {
    delete process.env.CLEARBOLT_WAF_MAX_ATTEMPTS;
    expect(resolveWafMaxAttempts()).toBe(3);
    process.env.CLEARBOLT_WAF_MAX_ATTEMPTS = "5";
    expect(resolveWafMaxAttempts()).toBe(5);
  });

  it("akamaiHardBlockProxyRetryAttempts defaults to 1", () => {
    delete process.env.CLEARBOLT_AKAMAI_HARD_BLOCK_PROXY_RETRY;
    expect(akamaiHardBlockProxyRetryAttempts()).toBe(1);
    process.env.CLEARBOLT_AKAMAI_HARD_BLOCK_PROXY_RETRY = "0";
    expect(akamaiHardBlockProxyRetryAttempts()).toBe(0);
    process.env.CLEARBOLT_AKAMAI_HARD_BLOCK_PROXY_RETRY = "2";
    expect(akamaiHardBlockProxyRetryAttempts()).toBe(2);
  });
});
