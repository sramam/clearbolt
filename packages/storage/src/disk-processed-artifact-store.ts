import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { EvidenceRef } from "@clearbolt/core";
import type {
  EvidenceMeta,
  ProcessedArtifactStore,
  ProcessedPutMeta,
} from "./contracts.js";

function extForContentType(contentType: string): string {
  if (contentType.includes("json")) return "json";
  if (contentType.includes("markdown")) return "md";
  return "html";
}

async function payloadToBuffer(
  payload: Uint8Array | Readable,
): Promise<Buffer> {
  if (!("pipe" in payload)) {
    return Buffer.from(payload);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of payload) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class DiskProcessedArtifactStore implements ProcessedArtifactStore {
  constructor(private readonly rootDir: string) {}

  private dir(adapter: string, kind: string) {
    return join(this.rootDir, "processed", adapter, kind);
  }

  async put(
    payload: Uint8Array | Readable,
    meta: ProcessedPutMeta,
  ): Promise<EvidenceRef> {
    const buf = await payloadToBuffer(payload);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const ext = extForContentType(meta.contentType);
    const dir = this.dir(meta.adapter, meta.kind);
    await mkdir(dir, { recursive: true });
    const file = `${sha256}.${ext}`;
    const path = join(dir, file);
    await writeFile(path, buf);

    return {
      bucket: "disk",
      key: join("processed", meta.adapter, meta.kind, file),
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
    const { readdir } = await import("node:fs/promises");
    const root = join(this.rootDir, "processed");
    try {
      const adapters = await readdir(root, { withFileTypes: true });
      for (const a of adapters) {
        if (!a.isDirectory()) continue;
        const kinds = await readdir(join(root, a.name), {
          withFileTypes: true,
        });
        for (const k of kinds) {
          if (!k.isDirectory()) continue;
          for (const ext of ["md", "json", "html"]) {
            try {
              await stat(join(root, a.name, k.name, `${sha256}.${ext}`));
              return true;
            } catch {
              /* */
            }
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
