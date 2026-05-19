import { describe, expect, it } from "vitest";
import { serperSearch } from "../src/serper-client.js";

describe("serperSearch", () => {
  it("POSTs query with X-API-KEY", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const mockFetch: typeof fetch = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return new Response(JSON.stringify({ organic: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await serperSearch("coffee", {
      apiKey: "sk-test",
      num: 5,
      fetchImpl: mockFetch,
    });

    expect(capturedUrl).toBe("https://google.serper.dev/search");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["X-API-KEY"]).toBe("sk-test");
    const body = JSON.parse(String(capturedInit?.body));
    expect(body.q).toBe("coffee");
    expect(body.num).toBe(5);
  });
});
