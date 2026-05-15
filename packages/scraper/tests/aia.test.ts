import tls from "node:tls";
import { afterEach, describe, expect, it } from "vitest";
import { HttpFetcher } from "../src/http-fetcher.js";
import {
  __testClearAiaAgentCache,
  __testExtractCaIssuersUrl,
} from "../src/tls-aia.js";

const INCOMPLETE_CHAIN = "https://incomplete-chain.badssl.com/";

describe("AIA TLS", () => {
  afterEach(() => {
    __testClearAiaAgentCache();
  });

  it("extracts_ca_issuers_url_from_incomplete_chain_leaf", async () => {
    const leafDer = await new Promise<Buffer>((resolve, reject) => {
      const host = "incomplete-chain.badssl.com";
      const socket = tls.connect(
        { host, port: 443, servername: host, rejectUnauthorized: false },
        () => {
          try {
            const peer = socket.getPeerCertificate();
            if (!peer?.raw) reject(new Error("no leaf"));
            else resolve(Buffer.from(peer.raw));
          } finally {
            socket.destroy();
          }
        },
      );
      socket.on("error", reject);
    });
    const url = __testExtractCaIssuersUrl(leafDer);
    expect(url).toMatch(/^https?:\/\//);
  });

  it("aia_completes_chain_for_incomplete_host", async () => {
    const fetcher = new HttpFetcher();
    const res = await fetcher.fetch({ url: INCOMPLETE_CHAIN });
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(100);
    expect(res.body.toLowerCase()).toContain("badssl");
  }, 45_000);
});
