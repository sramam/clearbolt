import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import type { WikiStore, WikiWriteOpts } from "@clearbolt/storage";

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function assertSafeWorkspaceId(workspaceId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(workspaceId)) {
    throw new Error(`invalid workspaceId: ${workspaceId}`);
  }
}

/** Relative wiki path using `/`; no `..`, no absolute segments. */
function normalizeRelPath(path: string): string {
  const s = path.replace(/^[/\\]+/, "").replace(/\\/g, "/");
  if (!s || s.includes("..") || s.startsWith("/")) {
    throw new Error(`invalid wiki path: ${path}`);
  }
  return s;
}

export class WikiFsStore implements WikiStore {
  constructor(private readonly rootDir: string) {}

  private wikiRoot(workspaceId: string): string {
    assertSafeWorkspaceId(workspaceId);
    return resolve(this.rootDir, "workspaces", workspaceId, "wiki");
  }

  private toFsPath(workspaceId: string, relPath: string): string {
    const rel = normalizeRelPath(relPath);
    const base = this.wikiRoot(workspaceId);
    const full = resolve(base, ...rel.split("/"));
    const relToBase = relative(base, full);
    if (relToBase.startsWith("..") || relToBase.includes(`${sep}..${sep}`)) {
      throw new Error("path escapes wiki root");
    }
    return full;
  }

  async read(
    workspaceId: string,
    path: string,
  ): Promise<{ content: string; sha256: string } | null> {
    try {
      const full = this.toFsPath(workspaceId, path);
      const content = await readFile(full, "utf8");
      return { content, sha256: sha256Hex(content) };
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return null;
      throw e;
    }
  }

  async write(
    workspaceId: string,
    path: string,
    content: string,
    _opts?: WikiWriteOpts,
  ): Promise<{ sha256: string }> {
    const full = this.toFsPath(workspaceId, path);
    await mkdir(resolve(full, ".."), { recursive: true });
    await writeFile(full, content, "utf8");
    return { sha256: sha256Hex(content) };
  }

  async *list(
    workspaceId: string,
    prefix?: string,
  ): AsyncIterable<{ path: string; lastModified: Date }> {
    const base = this.wikiRoot(workspaceId);
    await mkdir(base, { recursive: true });
    const pref = prefix ? normalizeRelPath(prefix) : "";
    yield* this.walk(base, base, pref);
  }

  private async *walk(
    absDir: string,
    wikiRootDir: string,
    prefixFilter: string,
  ): AsyncIterable<{ path: string; lastModified: Date }> {
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (e) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") return;
      throw e;
    }

    for (const e of entries) {
      if (e.name === "_snapshots") continue;
      const child = join(absDir, e.name);
      const relFromWiki = relative(wikiRootDir, child).replace(/\\/g, "/");
      if (e.isDirectory()) {
        yield* this.walk(child, wikiRootDir, prefixFilter);
      } else {
        if (prefixFilter && !relFromWiki.startsWith(prefixFilter)) continue;
        const st = await stat(child);
        yield { path: relFromWiki, lastModified: st.mtime };
      }
    }
  }

  async snapshot(
    workspaceId: string,
    path: string,
    contentSha256: string,
  ): Promise<void> {
    const full = this.toFsPath(workspaceId, path);
    const base = this.wikiRoot(workspaceId);
    const snapDir = join(base, "_snapshots");
    await mkdir(snapDir, { recursive: true });
    const name = `${encodeURIComponent(normalizeRelPath(path))}@${contentSha256}.md`;
    await copyFile(full, join(snapDir, name));
  }
}
