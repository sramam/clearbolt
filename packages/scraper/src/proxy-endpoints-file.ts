import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ProxyEndpointCredentials = {
  server: string;
  username: string;
  password: string;
};

let fileCache: { path: string; endpoints: ProxyEndpointCredentials[] } | null =
  null;

export function clearProxyEndpointsFileCache(): void {
  fileCache = null;
}

/**
 * One endpoint per line. Supported forms:
 * - `http(s)://user:pass@host:port`
 * - `host:port:user:pass` (password may contain `:`)
 * Lines starting with `#` are ignored.
 */
export function parseProxyEndpointLine(
  line: string,
): ProxyEndpointCredentials | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      const server = `http://${u.hostname}${u.port ? `:${u.port}` : ""}`;
      const username = u.username ? decodeURIComponent(u.username) : "";
      const password = u.password ? decodeURIComponent(u.password) : "";
      if (!username) return null;
      return { server, username, password };
    } catch {
      return null;
    }
  }

  const parts = trimmed.split(":");
  if (parts.length < 4) return null;
  const host = parts[0]!;
  const port = parts[1]!;
  const username = parts[2]!;
  const password = parts.slice(3).join(":");
  if (!host || !port || !username) return null;
  return {
    server: `http://${host}:${port}`,
    username,
    password,
  };
}

export function parseProxyEndpointsFileContent(
  content: string,
): ProxyEndpointCredentials[] {
  const out: ProxyEndpointCredentials[] = [];
  for (const line of content.split(/\r?\n/)) {
    const ep = parseProxyEndpointLine(line);
    if (ep) out.push(ep);
  }
  return out;
}

export function resolveProxyEndpointsFilePath(filePath: string): string {
  return isAbsolute(filePath) ? filePath : resolve(process.cwd(), filePath);
}

export function loadProxyEndpointsFromFile(
  filePath: string,
): ProxyEndpointCredentials[] {
  const resolved = resolveProxyEndpointsFilePath(filePath);
  if (fileCache?.path === resolved) return fileCache.endpoints;
  const content = readFileSync(resolved, "utf8");
  const endpoints = parseProxyEndpointsFileContent(content);
  fileCache = { path: resolved, endpoints };
  return endpoints;
}

/** Stable pick per session key; spreads parallel fetches across ports. */
export function pickProxyEndpointFromList(
  endpoints: ProxyEndpointCredentials[],
  sessionKey?: string,
): ProxyEndpointCredentials | null {
  if (endpoints.length === 0) return null;
  if (endpoints.length === 1) return endpoints[0]!;
  const workerMatch = sessionKey?.match(/-w(\d+)-/);
  if (workerMatch) {
    const idx = Number.parseInt(workerMatch[1]!, 10);
    if (!Number.isNaN(idx)) return endpoints[idx % endpoints.length]!;
  }
  if (!sessionKey) return endpoints[0]!;
  let h = 0;
  for (let i = 0; i < sessionKey.length; i++) {
    h = (h + sessionKey.charCodeAt(i)) % endpoints.length;
  }
  return endpoints[h]!;
}
