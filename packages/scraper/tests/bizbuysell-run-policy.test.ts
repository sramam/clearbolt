import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  catalogDiscoveryWafPolicy,
  listingIngestWafPolicy,
  resolveBizBuySellDiscoveryMode,
  serperSupplementEnabled,
  shouldKeepCatalogDiscoveryOnHttpLane,
  shouldUseBrowserFirstForBizBuySell,
} from "../src/bizbuysell-run-policy.js";

describe("bizbuysell-run-policy", () => {
  const env = process.env;

  beforeEach(() => {
    process.env.CLEARBOLT_BIZBUYSELL_DISCOVERY = undefined;
    process.env.SERP_DEV_API_KEY = undefined;
    process.env.SERPER_API_KEY = undefined;
    process.env.CLEARBOLT_BIZBUYSELL_SERPER_SUPPLEMENT = undefined;
    process.env.CLEARBOLT_PROXY_RESIDENTIAL = undefined;
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = undefined;
  });

  afterEach(() => {
    process.env = env;
  });

  it("defaults discovery to direct even when Serper key is set", () => {
    process.env.SERP_DEV_API_KEY = "test-key";
    expect(resolveBizBuySellDiscoveryMode({})).toBe("direct");
  });

  it("allows explicit serper override", () => {
    process.env.SERP_DEV_API_KEY = "test-key";
    expect(resolveBizBuySellDiscoveryMode({ discovery: "serper" })).toBe(
      "serper",
    );
  });

  it("enables serper supplement when key present", () => {
    process.env.SERP_DEV_API_KEY = "test-key";
    expect(serperSupplementEnabled()).toBe(true);
    process.env.CLEARBOLT_BIZBUYSELL_SERPER_SUPPLEMENT = "0";
    expect(serperSupplementEnabled()).toBe(false);
  });

  it("browser first only when explicitly enabled", () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@gate.decodo.com:10001";
    expect(shouldUseBrowserFirstForBizBuySell()).toBe(false);
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    expect(shouldUseBrowserFirstForBizBuySell()).toBe(true);
  });

  it("keeps catalog discovery on HTTP lane when proxy configured", () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@gate.decodo.com:10001";
    expect(shouldKeepCatalogDiscoveryOnHttpLane()).toBe(true);
    process.env.CLEARBOLT_BIZBUYSELL_BROWSER_FIRST = "1";
    expect(shouldKeepCatalogDiscoveryOnHttpLane()).toBe(false);
  });

  it("catalog discovery waf policy drops browser escalation", async () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@gate.decodo.com:10001";
    const browserFetcher = {
      fetch: async () => ({ status: 200, body: "", headers: {}, finalUrl: "" }),
    };
    const tuned = catalogDiscoveryWafPolicy({
      persistNeedsBrowser: async () => {},
      browserFetcher: browserFetcher as never,
      hostRequiresBrowser: async () => true,
    });
    expect(tuned.browserFetcher).toBeUndefined();
    expect(tuned.maxHttpAttempts).toBe(3);
    expect(await tuned.hostRequiresBrowser?.("m.bizbuysell.com")).toBe(false);
  });

  it("listing ingest waf policy keeps browser fetcher for http-first escalation", async () => {
    process.env.CLEARBOLT_PROXY_RESIDENTIAL =
      "http://u:p@gate.decodo.com:10001";
    process.env.CLEARBOLT_BIZBUYSELL_INGEST_HTTP = "1";
    const browserFetcher = {
      fetch: async () => ({ status: 200, body: "", headers: {}, finalUrl: "" }),
    };
    const tuned = listingIngestWafPolicy({
      persistNeedsBrowser: async () => {},
      browserFetcher: browserFetcher as never,
      browserLanePrimary: true,
    });
    expect(tuned.browserFetcher).toBe(browserFetcher);
    expect(tuned.browserLanePrimary).toBe(false);
    expect(await tuned.hostRequiresBrowser?.("m.bizbuysell.com")).toBe(false);
  });
});
