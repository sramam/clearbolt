import { describe, expect, it } from "vitest";
import { discoverNextBrokerSiteIndexPageUrl } from "../src/broker-site-pagination.js";

describe("discoverNextBrokerSiteIndexPageUrl", () => {
  it("finds rel=next link", () => {
    const html = `
      <html><body>
        <a rel="next" href="/listings?page=2">Next</a>
      </body></html>`;
    const result = discoverNextBrokerSiteIndexPageUrl(
      html,
      "https://broker.example.com/listings?page=1",
    );
    expect(result.strategyId).toBe("rel-next");
    expect(result.nextUrl).toContain("page=2");
  });

  it("finds query page=2 from anchor hints", () => {
    const html = `
      <html><body>
        <nav class="pagination">
          <a href="/for-sale?page=1">1</a>
          <a href="/for-sale?page=2">2</a>
        </nav>
      </body></html>`;
    const result = discoverNextBrokerSiteIndexPageUrl(
      html,
      "https://broker.example.com/for-sale?page=1",
    );
    expect(result.nextUrl).toBeTruthy();
    expect(result.nextUrl).toMatch(/page=2/);
  });

  it("returns null when no next page", () => {
    const html = "<html><body><p>Only page</p></body></html>";
    const result = discoverNextBrokerSiteIndexPageUrl(
      html,
      "https://broker.example.com/listings",
    );
    expect(result.nextUrl).toBeNull();
    expect(result.strategyId).toBeNull();
  });
});
