import http from "node:http";
import https from "node:https";
import { URL } from "node:url";
import type { RawResponse } from "@clearbolt/core";

export async function requestUrlFollowRedirects(
  startUrl: string,
  options: {
    headers: Record<string, string>;
    httpsAgent?: https.Agent;
    maxRedirects?: number;
  },
): Promise<RawResponse> {
  let url = startUrl;
  let redirects = 0;
  const max = options.maxRedirects ?? 5;
  for (;;) {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") {
      throw new Error(`unsupported protocol ${u.protocol}`);
    }
    const res = await singleRequest(u, options.headers, options.httpsAgent);
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      redirects++;
      if (redirects > max) throw new Error("too many redirects");
      url = new URL(res.headers.location, url).toString();
      continue;
    }
    return res;
  }
}

function singleRequest(
  u: URL,
  headers: Record<string, string>,
  httpsAgent: https.Agent | undefined,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const isHttps = u.protocol === "https:";
    const lib = isHttps ? https : http;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method: "GET",
        headers,
        agent: isHttps ? httpsAgent : undefined,
      },
      (incoming) => {
        const h: Record<string, string> = {};
        for (const [k, v] of Object.entries(incoming.headers)) {
          if (v == null) continue;
          h[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : v;
        }
        const chunks: Buffer[] = [];
        incoming.on("data", (c: Buffer) => chunks.push(c));
        incoming.on("end", () => {
          resolve({
            status: incoming.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
            finalUrl: u.href,
            headers: h,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}
