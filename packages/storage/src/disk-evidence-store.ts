import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { EvidenceRef, PutMeta } from "@clearbolt/core";
import type { EvidenceMeta, EvidenceStore } from "./contracts.js";

async function payloadToBuffer(
  payload: Uint8Array | Readable,
): Promise<Buffer> {
  if (!("pipe" in payload)) {
    return Buffer.from(payload);
  }
  return streamToBuffer(payload);
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class DiskEvidenceStore implements EvidenceStore {
  constructor(private readonly rootDir: string) {}

  private rawDir(adapter: string) {
    return join(this.rootDir, "raw", adapter);
  }

  async put(
    payload: Uint8Array | Readable,
    meta: PutMeta,
  ): Promise<EvidenceRef> {
    const buf = await payloadToBuffer(payload);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const ext = meta.contentType.includes("json") ? "json" : "html";
    const dir = this.rawDir(meta.adapter);
    await mkdir(dir, { recursive: true });
    const key = `${sha256}.${ext}`;
    const path = join(dir, key);
    await writeFile(path, buf);

    return {
      bucket: "disk",
      key: join("raw", meta.adapter, key),
      sha256,
      contentType: meta.contentType,
      sizeBytes: buf.length,
    };
  }

  async get(ref: EvidenceRef): Promise<Readable> {
    const path = join(this.rootDir, ref.key);
    const buf = await readFile(path);
    return Readable.from(buf);
  }

  async exists(sha256: string): Promise<boolean> {
    // scan adapters under raw/ — V0 simple: try common extensions
    const { readdir } = await import("node:fs/promises");
    const rawRoot = join(this.rootDir, "raw");
    try {
      const adapters = await readdir(rawRoot, { withFileTypes: true });
      for (const d of adapters) {
        if (!d.isDirectory()) continue;
        for (const ext of ["html", "json"]) {
          const p = join(rawRoot, d.name, `${sha256}.${ext}`);
          try {
            await stat(p);
            return true;
          } catch {
            /* */
          }
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  async head(ref: EvidenceRef): Promise<EvidenceMeta> {
    const path = join(this.rootDir, ref.key);
    const s = await stat(path);
    return {
      sha256: ref.sha256,
      contentType: ref.contentType,
      sizeBytes: s.size,
      key: ref.key,
      bucket: ref.bucket,
    };
  }
}
