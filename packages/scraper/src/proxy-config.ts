/** Env-driven proxy tiers: direct → datacenter → residential (cost-aware). */

import {
  loadProxyEndpointsFromFile,
  pickProxyEndpointFromList,
} from "./proxy-endpoints-file.js";

export type ProxyTier = "direct" | "datacenter" | "residential";

export type ProxyEndpoint = {
  tier: ProxyTier;
  /** `http://host:port` or `socks5://host:port` (Playwright); no credentials in URL. */
  server: string;
  username?: string;
  password?: string;
};

export type ProxyPolicy =
  | "direct"
  | "datacenter"
  | "datacenter-first"
  /** Direct from Fly/home IP; residential only after WAF marks the host (cheapest). */
  | "direct-then-residential"
  | "residential";

function envTrim(key: string): string | undefined {
  const v = process.env[key]?.trim();
  return v || undefined;
}

export function readProxyPolicy(): ProxyPolicy {
  const raw = envTrim("CLEARBOLT_PROXY_POLICY") ?? "direct";
  if (
    raw === "direct" ||
    raw === "datacenter" ||
    raw === "datacenter-first" ||
    raw === "direct-then-residential" ||
    raw === "residential"
  ) {
    return raw;
  }
  return "direct";
}

/** Policies that may escalate a host from direct/datacenter to residential after WAF signals. */
export function proxyEscalationEnabled(): boolean {
  const p = readProxyPolicy();
  return p === "datacenter-first" || p === "direct-then-residential";
}

export function residentialProxyConfigured(): boolean {
  const endpointsFile = envTrim("CLEARBOLT_PROXY_ENDPOINTS_FILE");
  if (endpointsFile) {
    try {
      return loadProxyEndpointsFromFile(endpointsFile).length > 0;
    } catch {
      return false;
    }
  }
  return Boolean(resolveProxyEndpoint("residential"));
}

/** True when HTTP may retry through residential before the browser lane. */
export function canEscalateHostToResidential(_host: string): boolean {
  return proxyEscalationEnabled() && residentialProxyConfigured();
}

function applyProxyCountry(username: string | undefined): string | undefined {
  if (!username) return username;
  if (envTrim("CLEARBOLT_PROXY_USERNAME_STYLE") === "decodo") return username;
  const country = envTrim("CLEARBOLT_PROXY_COUNTRY")?.toLowerCase();
  if (!country) return username;
  const marker = `country-${country}`;
  if (username.toLowerCase().includes(marker)) return username;
  return `${username}_${marker}`;
}

/** Decodo/Smartproxy: user-{id}-country-us-session-{id}-sessionduration-{minutes} */
export function buildDecodoProxyUsername(
  baseUsername: string,
  sessionKey: string,
  opts?: { country?: string; durationMinutes?: number },
): string {
  const country =
    opts?.country?.toLowerCase() ??
    envTrim("CLEARBOLT_PROXY_COUNTRY")?.toLowerCase();
  const duration =
    opts?.durationMinutes ??
    Number.parseInt(
      envTrim("CLEARBOLT_PROXY_SESSION_DURATION_MINUTES") ?? "10",
      10,
    );
  let user = baseUsername.startsWith("user-")
    ? baseUsername
    : `user-${baseUsername}`;
  if (country && !user.toLowerCase().includes(`-country-${country}`)) {
    user = `${user}-country-${country}`;
  }
  if (!user.includes("-session-")) {
    user = `${user}-session-${sessionKey}-sessionduration-${duration}`;
  }
  return user;
}

function finalizeProxyUsername(
  baseUsername: string | undefined,
  sessionKey: string | undefined,
): string | undefined {
  if (!baseUsername) return baseUsername;
  const session =
    sessionKey ?? envTrim("CLEARBOLT_PROXY_SESSION_ID") ?? undefined;
  if (envTrim("CLEARBOLT_PROXY_USERNAME_STYLE") === "decodo") {
    return buildDecodoProxyUsername(baseUsername, session ?? "clearbolt");
  }
  return applyProxyCountry(withSessionUsername(baseUsername, session));
}

function parseProxyUrl(raw: string, tier: ProxyTier): ProxyEndpoint | null {
  try {
    const u = new URL(raw);
    const protocol =
      u.protocol === "https:" && u.hostname.includes("gate.")
        ? "http:"
        : u.protocol;
    const server = `${protocol}//${u.hostname}${u.port ? `:${u.port}` : ""}`;
    const username = u.username ? decodeURIComponent(u.username) : undefined;
    const password = u.password ? decodeURIComponent(u.password) : undefined;
    return { tier, server, username, password };
  } catch {
    return null;
  }
}

function withSessionUsername(
  username: string | undefined,
  sessionKey: string | undefined,
): string | undefined {
  if (!username || !sessionKey) return username;
  const suffix = envTrim("CLEARBOLT_PROXY_SESSION_SUFFIX");
  if (suffix) return `${username}${suffix.replace("{session}", sessionKey)}`;
  return `${username}-sessid-${sessionKey}`;
}

function resolveResidentialFromEndpointsFile(
  sessionKey?: string,
): ProxyEndpoint | null {
  const file = envTrim("CLEARBOLT_PROXY_ENDPOINTS_FILE");
  if (!file) return null;
  const picked = pickProxyEndpointFromList(
    loadProxyEndpointsFromFile(file),
    sessionKey,
  );
  if (!picked) return null;
  const session =
    sessionKey ?? envTrim("CLEARBOLT_PROXY_SESSION_ID") ?? undefined;
  return {
    tier: "residential",
    server: picked.server,
    username: finalizeProxyUsername(picked.username, session),
    password: picked.password,
  };
}

export function resolveProxyEndpoint(
  tier: ProxyTier,
  sessionKey?: string,
): ProxyEndpoint | null {
  if (tier === "direct") return null;
  if (tier === "residential") {
    const fromFile = resolveResidentialFromEndpointsFile(sessionKey);
    if (fromFile) return fromFile;
  }
  const raw =
    tier === "residential"
      ? envTrim("CLEARBOLT_PROXY_RESIDENTIAL")
      : envTrim("CLEARBOLT_PROXY_DATACENTER");
  if (!raw) return null;
  const ep = parseProxyUrl(raw, tier);
  if (!ep) return null;
  const session =
    sessionKey ?? envTrim("CLEARBOLT_PROXY_SESSION_ID") ?? undefined;
  ep.username = finalizeProxyUsername(ep.username, session);
  return ep;
}

export function initialProxyTierForHost(_host: string): ProxyTier {
  const policy = readProxyPolicy();
  if (policy === "direct" || policy === "direct-then-residential")
    return "direct";
  if (policy === "residential") return "residential";
  if (policy === "datacenter") return "datacenter";
  if (policy === "datacenter-first" && envTrim("CLEARBOLT_PROXY_DATACENTER")) {
    return "datacenter";
  }
  return "direct";
}

const hostResidential = new Set<string>();

/** Clears in-process residential escalation (tests and long-lived scraper workers). */
export function clearProxyHostEscalations(): void {
  hostResidential.clear();
}

export function markHostUseResidential(host: string): void {
  if (proxyEscalationEnabled()) {
    hostResidential.add(host.toLowerCase());
  }
}

export function shouldUseResidentialForHost(host: string): boolean {
  if (readProxyPolicy() === "residential") return true;
  return hostResidential.has(host.toLowerCase());
}

export function proxyTierForHost(host: string, sessionKey?: string): ProxyTier {
  if (shouldUseResidentialForHost(host)) {
    if (resolveProxyEndpoint("residential", sessionKey)) return "residential";
  }
  const initial = initialProxyTierForHost(host);
  if (initial !== "direct" && resolveProxyEndpoint(initial, sessionKey)) {
    return initial;
  }
  return "direct";
}

/** Undici / curl-style proxy URL with credentials. */
export function proxyDispatcherUrl(
  tier: ProxyTier,
  sessionKey?: string,
): string | undefined {
  const ep = resolveProxyEndpoint(tier, sessionKey);
  if (!ep) return undefined;
  if (ep.username && ep.password) {
    const u = new URL(ep.server);
    u.username = encodeURIComponent(ep.username);
    u.password = encodeURIComponent(ep.password);
    return u.toString();
  }
  return ep.server;
}

export function playwrightProxyOptions(
  tier: ProxyTier,
  sessionKey?: string,
): { server: string; username?: string; password?: string } | undefined {
  const ep = resolveProxyEndpoint(tier, sessionKey);
  if (!ep) return undefined;
  return {
    server: ep.server,
    username: ep.username,
    password: ep.password,
  };
}

export function proxyTierForHostAndSession(
  host: string,
  sessionKey?: string,
): ProxyTier {
  return proxyTierForHost(host, sessionKey);
}

export function proxySessionKeyFromEnv(): string | undefined {
  return envTrim("CLEARBOLT_PROXY_SESSION_ID");
}

/** Count of residential endpoints in CLEARBOLT_PROXY_ENDPOINTS_FILE (or 1 if single URL). */
export function residentialProxyEndpointCount(): number {
  const file = envTrim("CLEARBOLT_PROXY_ENDPOINTS_FILE");
  if (file) {
    try {
      return loadProxyEndpointsFromFile(file).length;
    } catch {
      return 0;
    }
  }
  return envTrim("CLEARBOLT_PROXY_RESIDENTIAL") ? 1 : 0;
}

export { proxySessionKeyForWorker } from "./proxy-session-rotate.js";
