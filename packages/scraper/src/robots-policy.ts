/** Minimal robots.txt parser (User-agent groups, Allow/Disallow, Crawl-delay). */

export type RobotsGroup = {
  agents: string[];
  allow: string[];
  disallow: string[];
  /** Seconds between requests when declared. */
  crawlDelaySec?: number;
};

export type ParsedRobots = {
  groups: RobotsGroup[];
  /** Sitemap lines (informational only in V0). */
  sitemaps: string[];
};

const DEFAULT_UA = "ClearboltScraper";

export function scraperUserAgent(): string {
  return process.env.CLEARBOLT_SCRAPER_USER_AGENT?.trim() || DEFAULT_UA;
}

export function parseRobotsTxt(body: string): ParsedRobots {
  const groups: RobotsGroup[] = [];
  const sitemaps: string[] = [];
  let current: RobotsGroup | null = null;

  const flush = () => {
    if (current && current.agents.length > 0) groups.push(current);
    current = null;
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.split("#")[0]?.trim() ?? "";
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (!value && key !== "disallow") continue;

    if (key === "user-agent") {
      if (current && !current.agents.includes(value.toLowerCase())) {
        current.agents.push(value.toLowerCase());
      } else if (!current) {
        current = {
          agents: [value.toLowerCase()],
          allow: [],
          disallow: [],
        };
      } else {
        flush();
        current = {
          agents: [value.toLowerCase()],
          allow: [],
          disallow: [],
        };
      }
      continue;
    }

    if (!current) {
      if (key === "sitemap") sitemaps.push(value);
      continue;
    }

    if (key === "allow") current.allow.push(value);
    else if (key === "disallow") current.disallow.push(value);
    else if (key === "crawl-delay") {
      const n = Number.parseFloat(value);
      if (Number.isFinite(n) && n >= 0) current.crawlDelaySec = n;
    } else if (key === "sitemap") sitemaps.push(value);
  }
  flush();
  return { groups, sitemaps };
}

function agentMatches(groupAgent: string, requestAgent: string): boolean {
  const g = groupAgent.toLowerCase();
  const r = requestAgent.toLowerCase();
  if (g === "*") return true;
  return r.startsWith(g);
}

function pickGroup(
  parsed: ParsedRobots,
  userAgent: string,
): RobotsGroup | null {
  let best: RobotsGroup | null = null;
  let bestLen = -1;
  for (const group of parsed.groups) {
    for (const agent of group.agents) {
      if (!agentMatches(agent, userAgent)) continue;
      const len = agent === "*" ? 0 : agent.length;
      if (len > bestLen) {
        best = group;
        bestLen = len;
      }
    }
  }
  return best;
}

function ruleMatches(pathname: string, rule: string): boolean {
  if (!rule) return false;
  if (rule === "/") return pathname === "/" || pathname.startsWith("/");
  return pathname.startsWith(rule);
}

/** Longest matching rule wins; allow beats disallow on equal length. */
export function isPathAllowed(
  pathname: string,
  parsed: ParsedRobots,
  userAgent = scraperUserAgent(),
): boolean {
  const group = pickGroup(parsed, userAgent);
  if (!group) return true;

  let bestAllow = -1;
  let bestDisallow = -1;
  for (const rule of group.allow) {
    if (ruleMatches(pathname, rule))
      bestAllow = Math.max(bestAllow, rule.length);
  }
  for (const rule of group.disallow) {
    if (ruleMatches(pathname, rule)) {
      bestDisallow = Math.max(bestDisallow, rule.length);
    }
  }
  if (bestAllow < 0 && bestDisallow < 0) return true;
  if (bestAllow >= bestDisallow) return true;
  return false;
}

export function crawlDelayMsFromRobots(
  parsed: ParsedRobots,
  userAgent = scraperUserAgent(),
): number | undefined {
  const group = pickGroup(parsed, userAgent);
  if (!group?.crawlDelaySec) return undefined;
  return Math.ceil(group.crawlDelaySec * 1000);
}

type RobotsCacheEntry = {
  fetchedAt: number;
  parsed: ParsedRobots | null;
};

const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;
const cache = new Map<string, RobotsCacheEntry>();

export function clearRobotsCacheForTests(): void {
  cache.clear();
}

export async function loadRobotsForOrigin(
  origin: string,
  fetchRobots: (url: string) => Promise<string | null>,
): Promise<ParsedRobots | null> {
  const key = origin.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < ROBOTS_TTL_MS) {
    return hit.parsed;
  }
  const url = `${origin}/robots.txt`;
  let body: string | null = null;
  try {
    body = await fetchRobots(url);
  } catch {
    body = null;
  }
  const parsed = body == null ? null : parseRobotsTxt(body);
  cache.set(key, { fetchedAt: Date.now(), parsed });
  return parsed;
}

export function isUrlAllowedByRobots(
  url: string,
  parsed: ParsedRobots | null,
  userAgent = scraperUserAgent(),
): boolean {
  if (!parsed) return true;
  const pathname = new URL(url).pathname || "/";
  return isPathAllowed(pathname, parsed, userAgent);
}
