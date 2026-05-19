import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BIZBUYSELL_LIVE_CACHE_FILENAME,
  parseBizBuySellLiveCache,
} from "../src/fixtures/bizbuysell-fixture-cache.js";
import {
  serializeBizBuySellLiveCacheForCompare,
  validateBizBuySellLiveCacheInvariants,
} from "../src/fixtures/bizbuysell-live-cache-validate.js";
import { buildBizBuySellFixtureFetcher } from "../src/fixtures/build-bizbuysell-fixture-fetcher.js";
import { maskBizBuySellHtml } from "../src/fixtures/mask-bizbuysell-html.js";

describe("bizbuysell live fixture cache", () => {
  it("parseBizBuySellLiveCache rejects invalid payloads", () => {
    expect(parseBizBuySellLiveCache("")).toBeNull();
    expect(parseBizBuySellLiveCache("{}")).toBeNull();
    expect(parseBizBuySellLiveCache(JSON.stringify({ version: 2 }))).toBeNull();
  });

  it("parseBizBuySellLiveCache defaults missing fetchedAt", () => {
    const raw = JSON.stringify({
      version: 1,
      searchUrl: "https://www.bizbuysell.com/businesses-for-sale/",
      searchHtml:
        '<html><body><a href="/x-business-for-sale/8888888/">x</a></body></html>',
      listings: [
        {
          requestUrl: "https://www.bizbuysell.com/x-business-for-sale/8888888/",
          finalUrl: "https://www.bizbuysell.com/x-business-for-sale/8888888/",
          html: "<html><title>t</title></html>",
        },
      ],
    });
    const c = parseBizBuySellLiveCache(raw);
    expect(c).not.toBeNull();
    expect(c?.fetchedAt).toBe("1970-01-01T00:00:00.000Z");
  });

  it("maskBizBuySellHtml removes script tags", () => {
    const out = maskBizBuySellHtml(
      "<html><script>volatile()</script><body><p>ok</p></body></html>",
    );
    expect(out.toLowerCase()).not.toContain("script");
    expect(out).toContain("ok");
  });

  it("serializeBizBuySellLiveCacheForCompare ignores fetchedAt and scripts", () => {
    const a = {
      version: 1 as const,
      fetchedAt: "2020-01-01T00:00:00.000Z",
      searchUrl: "https://www.bizbuysell.com/businesses-for-sale/",
      searchHtml:
        '<html><body><script src="https://cdn/x.js?v=1"></script><a href="/z-business-for-sale/7777777/">z</a></body></html>',
      listings: [
        {
          requestUrl: "https://www.bizbuysell.com/z-business-for-sale/7777777/",
          finalUrl: "https://www.bizbuysell.com/z-business-for-sale/7777777/",
          html: "<html><script>1</script><title>t</title></html>",
        },
      ],
    };
    const b = {
      ...a,
      fetchedAt: "2030-06-15T12:00:00.000Z",
      searchHtml:
        '<html><body><script src="https://cdn/x.js?v=99"></script><a href="/z-business-for-sale/7777777/">z</a></body></html>',
    };
    expect(serializeBizBuySellLiveCacheForCompare(a)).toBe(
      serializeBizBuySellLiveCacheForCompare(b),
    );
  });

  it("validateBizBuySellLiveCacheInvariants accepts minimal cache", async () => {
    const cache = {
      version: 1 as const,
      fetchedAt: "2020-01-01T00:00:00.000Z",
      searchUrl: "https://www.bizbuysell.com/businesses-for-sale/",
      searchHtml:
        '<html><body><a href="/y-business-for-sale/6666666/">y</a></body></html>',
      listings: [
        {
          requestUrl: "https://www.bizbuysell.com/y-business-for-sale/6666666/",
          finalUrl: "https://www.bizbuysell.com/y-business-for-sale/6666666/",
          html: "<html><title>Co</title></html>",
        },
      ],
    };
    const v = await validateBizBuySellLiveCacheInvariants(cache);
    expect(v.ok).toBe(true);
  });

  it("buildBizBuySellFixtureFetcher uses live cache when listings are present", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cbc-bbs-fix-"));
    const cache = {
      version: 1,
      fetchedAt: "2020-01-01T00:00:00.000Z",
      searchUrl: "https://www.bizbuysell.com/businesses-for-sale/",
      searchHtml:
        '<html><body><a href="/foo-business-for-sale/9999999/">x</a></body></html>',
      listings: [
        {
          requestUrl:
            "https://www.bizbuysell.com/foo-business-for-sale/9999999/",
          finalUrl: "https://www.bizbuysell.com/foo-business-for-sale/9999999/",
          html: "<html><title>LiveCo</title></html>",
        },
      ],
    };
    await writeFile(
      join(dir, BIZBUYSELL_LIVE_CACHE_FILENAME),
      JSON.stringify(cache),
    );
    const { fetcher, fixtureSearchUrl } =
      await buildBizBuySellFixtureFetcher(dir);
    expect(fixtureSearchUrl).toBe(cache.searchUrl);
    const r = await fetcher.fetch({ url: cache.listings[0].requestUrl });
    expect(r.status).toBe(200);
    expect(r.body).toContain("LiveCo");
  });
});
