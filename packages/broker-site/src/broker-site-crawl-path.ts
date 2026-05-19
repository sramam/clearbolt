import { join } from "node:path";
import { registrableDomain } from "./marketplace-hosts.js";

export function sitePathSlugFromUrl(siteUrl: string): string {
  try {
    const u = new URL(siteUrl);
    const host = registrableDomain(u.hostname);
    const path = u.pathname.replace(/^\/+|\/+$/g, "") || "index";
    const slug =
      path === "index" || path === "" ? host : `${host}__${path.replace(/\//g, "__")}`;
    return slug.replace(/[^a-zA-Z0-9._-]+/g, "_");
  } catch {
    return "site";
  }
}

export function defaultBrokerSiteCrawlStatePath(
  siteUrl: string,
  dataRootDir = "data",
): string {
  return join(
    dataRootDir,
    "broker-site-crawls",
    `${sitePathSlugFromUrl(siteUrl)}.json`,
  );
}
