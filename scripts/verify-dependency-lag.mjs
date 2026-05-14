/**
 * Ensures every npm tarball in pnpm-lock.yaml was published at least
 * `minimumReleaseAgeMinutes` ago (see scripts/dependency-lag.config.json).
 *
 * pnpm's minimumReleaseAge does not re-check versions already pinned in the
 * lockfile (see pnpm#10438), so CI runs this after install.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const LOCK_PATH = join(ROOT, "pnpm-lock.yaml");
const CONFIG_PATH = join(__dirname, "dependency-lag.config.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
const { minimumReleaseAgeMinutes } = config;
/** @type {{ name: string; version: string; reason: string; expires?: string }[]} */
const securityAgeExceptions = Array.isArray(config.securityAgeExceptions)
  ? config.securityAgeExceptions
  : [];

const LAG_MS = minimumReleaseAgeMinutes * 60 * 1000;
const nowMs = Date.now();

/**
 * Explicit allowlist for packages that must be newer than the lag window
 * (e.g. security fixes). Optional `expires` (ISO date) drops the bypass after
 * that day so entries are reviewed and removed.
 * @returns {Map<string, { reason: string; expires?: string }>}
 */
function loadSecurityExceptionMap() {
  /** @type {Map<string, { reason: string; expires?: string }>} */
  const map = new Map();
  for (const row of securityAgeExceptions) {
    if (!row?.name || !row?.version || !row?.reason) {
      throw new Error(
        "dependency-lag.config.json: each securityAgeExceptions entry needs name, version, reason",
      );
    }
    const key = `${row.name}@${row.version}`;
    if (map.has(key)) {
      throw new Error(
        `dependency-lag.config.json: duplicate securityAgeExceptions key ${key}`,
      );
    }
    map.set(key, { reason: row.reason, expires: row.expires });
  }
  return map;
}

/**
 * @param {Map<string, { reason: string; expires?: string }>} exceptionMap
 * @param {string} name
 * @param {string} version
 */
function securityExceptionAllowsFresh(exceptionMap, name, version) {
  const meta = exceptionMap.get(`${name}@${version}`);
  if (!meta) return false;
  if (meta.expires) {
    const end = Date.parse(`${meta.expires}T23:59:59.999Z`);
    if (Number.isNaN(end)) {
      throw new Error(
        `dependency-lag.config.json: invalid expires for ${name}@${version}: ${meta.expires}`,
      );
    }
    if (nowMs > end) return false;
  }
  return true;
}

/** @param {string} key e.g. @scope/pkg@1.0.0 or pkg@1.0.0(peer...) */
function parsePackageKey(key) {
  const base = key.includes("(") ? key.slice(0, key.indexOf("(")) : key;
  const m = base.match(/^(@[^/@]+\/[^@]+|[^@]+)@(.+)$/);
  if (!m) return null;
  return { name: m[1], version: m[2] };
}

/** @returns {Generator<string, void, void>} */
function* packageKeysFromLockfile(content) {
  const lines = content.split("\n");
  let inPackages = false;
  for (const line of lines) {
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (!inPackages) continue;
    if (line.length > 0 && !line.startsWith(" ") && !line.startsWith("\t")) {
      break;
    }
    const m = line.match(/^ {2}'([^']+)':\s*$/);
    if (m) yield m[1];
  }
}

/** @type {Map<string, Record<string, string>>} */
const packumentCache = new Map();

async function getPackument(name) {
  if (packumentCache.has(name)) return packumentCache.get(name);
  const url = `https://registry.npmjs.org/${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`registry ${name}: HTTP ${res.status}`);
  }
  const body = await res.json();
  const time = body.time && typeof body.time === "object" ? body.time : null;
  if (!time) {
    throw new Error(`registry ${name}: missing time field`);
  }
  packumentCache.set(name, time);
  return time;
}

function publishedAt(timeMap, version) {
  const raw = timeMap[version];
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/**
 * @template T
 * @param {T[]} items
 * @param {number} limit
 * @param {(item: T) => Promise<void>} fn
 */
async function runPool(items, limit, fn) {
  const iter = items.values();
  async function worker() {
    for (;;) {
      const next = iter.next();
      if (next.done) break;
      await fn(next.value);
    }
  }
  const n = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function main() {
  const exceptionMap = loadSecurityExceptionMap();
  const lock = readFileSync(LOCK_PATH, "utf8");
  const keys = [...packageKeysFromLockfile(lock)];
  /** @type {Map<string, Set<string>>} */
  const byName = new Map();
  for (const key of keys) {
    const parsed = parsePackageKey(key);
    if (!parsed) continue;
    if (!byName.has(parsed.name)) byName.set(parsed.name, new Set());
    byName.get(parsed.name).add(parsed.version);
  }

  /** @type {{ name: string; version: string; reason: string }[]} */
  const tooFresh = [];
  let securitySkips = 0;

  const names = [...byName.keys()];
  await runPool(names, 12, async (name) => {
    const timeMap = await getPackument(name);
    for (const version of byName.get(name)) {
      if (securityExceptionAllowsFresh(exceptionMap, name, version)) {
        securitySkips++;
        continue;
      }
      const pub = publishedAt(timeMap, version);
      if (pub === null) {
        tooFresh.push({
          name,
          version,
          reason: "no publish timestamp for this version in registry metadata",
        });
        continue;
      }
      const age = nowMs - pub;
      if (age < LAG_MS) {
        tooFresh.push({
          name,
          version,
          reason: `published ${(age / 86_400_000).toFixed(2)}d ago; required >= ${(LAG_MS / 86_400_000).toFixed(2)}d`,
        });
      }
    }
  });

  if (tooFresh.length > 0) {
    console.error(
      `[verify-dependency-lag] ${tooFresh.length} package(s) violate minimum release age (${minimumReleaseAgeMinutes} minutes):`,
    );
    for (const row of tooFresh) {
      console.error(`  - ${row.name}@${row.version}: ${row.reason}`);
    }
    console.error(
      "  Hint: for an intentional security bump before the lag window, add a short-lived entry to securityAgeExceptions in scripts/dependency-lag.config.json (use expires).",
    );
    process.exit(1);
  }
  let nVersions = 0;
  for (const v of byName.values()) nVersions += v.size;
  const skipNote =
    securitySkips > 0
      ? ` (${securitySkips} allowed via securityAgeExceptions)`
      : "";
  console.log(
    `[verify-dependency-lag] ok — ${nVersions} unique registry tarball(s) across ${names.length} package name(s) are at least ${minimumReleaseAgeMinutes} minutes old.${skipNote}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
