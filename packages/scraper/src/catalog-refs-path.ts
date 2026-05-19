import { access } from "node:fs/promises";
import { join } from "node:path";
import { catalogRefsPath } from "./adapter-scoped-paths.js";

export { catalogRefsPath } from "./adapter-scoped-paths.js";
import { catalogAdapterFromUrl } from "./catalog-adapter-from-url.js";
import {
  CatalogRefsAdapterMismatchError,
  type CatalogRefsFile,
  readCatalogRefsFile,
  resolveCatalogRefsPath,
} from "./catalog-refs-file.js";

export function catalogPathSlugFromUrl(catalogUrl: string): string {
  try {
    return new URL(catalogUrl).pathname.replace(/^\/+|\/+$/g, "") || "catalog";
  } catch {
    return "catalog";
  }
}

/**
 * Slug for default on-disk catalog refs path
 * (`<dataRoot>/catalog-refs/<adapter>/<catalog-path>.json`).
 */
export function catalogSlugFromUrl(catalogUrl: string): string {
  const adapter = catalogAdapterFromUrl(catalogUrl);
  const path = catalogPathSlugFromUrl(catalogUrl);
  return `${adapter}/${path}`;
}

export function defaultCatalogRefsPath(
  catalogUrl: string,
  dataRootDir = "data",
): string {
  const adapter = catalogAdapterFromUrl(catalogUrl);
  const pathSlug = catalogPathSlugFromUrl(catalogUrl);
  return catalogRefsPath(dataRootDir, adapter, pathSlug);
}

/** Pre-adapter layout: `catalog-refs/<hostname>/<path>.json`. */
export function legacyHostCatalogRefsPath(
  catalogUrl: string,
  dataRootDir = "data",
): string {
  try {
    const u = new URL(catalogUrl);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = catalogPathSlugFromUrl(catalogUrl);
    return join(dataRootDir, "catalog-refs", `${host}/${path}.json`);
  } catch {
    return join(dataRootDir, "catalog-refs", "catalog.json");
  }
}

/** Earliest layout: `catalog-refs/<path>.json` (no adapter or host segment). */
export function legacyFlatCatalogRefsPath(
  catalogUrl: string,
  dataRootDir = "data",
): string {
  const path = catalogPathSlugFromUrl(catalogUrl);
  return join(dataRootDir, "catalog-refs", `${path}.json`);
}

/** Paths to try when loading cached discovery (adapter-scoped path first, then legacy). */
export function catalogRefsReadPathCandidates(
  catalogUrl: string,
  dataRootDir = "data",
): string[] {
  const candidates = [
    defaultCatalogRefsPath(catalogUrl, dataRootDir),
    legacyHostCatalogRefsPath(catalogUrl, dataRootDir),
    legacyFlatCatalogRefsPath(catalogUrl, dataRootDir),
  ];
  return [...new Set(candidates)];
}

export type LoadedCatalogRefs = {
  path: string;
  file: CatalogRefsFile;
};

/**
 * Load the first existing catalog-refs file for this URL whose `adapter` matches
 * `expectedAdapter` (skips legacy paths that belong to another marketplace).
 */
export async function loadCatalogRefsForAdapter(
  catalogUrl: string,
  expectedAdapter: string,
  dataRootDir = "data",
): Promise<LoadedCatalogRefs | undefined> {
  for (const candidate of catalogRefsReadPathCandidates(
    catalogUrl,
    dataRootDir,
  )) {
    try {
      await access(resolveCatalogRefsPath(candidate));
    } catch {
      continue;
    }
    try {
      const file = await readCatalogRefsFile(candidate, {
        expectedAdapter,
      });
      return { path: candidate, file };
    } catch (err) {
      if (err instanceof CatalogRefsAdapterMismatchError) continue;
      throw err;
    }
  }
  return undefined;
}
