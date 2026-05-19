import { createHash } from "node:crypto";
import type { Readable } from "node:stream";
import {
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
import type { EvidenceRef, PutMeta } from "@clearbolt/core";
import type { EvidenceMeta, EvidenceStore } from "@clearbolt/storage";
import type { R2EvidenceStoreConfig } from "./config.js";
import { sharedEvidenceKey } from "./keys.js";

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

function isNotFound(err: unknown): boolean {
  const e = err as S3ServiceException;
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

export class R2EvidenceStore implements EvidenceStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: R2EvidenceStoreConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }

  private objectKey(
    adapter: string,
    sha256: string,
    contentType: string,
  ): string {
    return sharedEvidenceKey(adapter, sha256, contentType);
  }

  async put(
    payload: Uint8Array | Readable,
    meta: PutMeta,
  ): Promise<EvidenceRef> {
    const buf = await payloadToBuffer(payload);
    const sha256 = createHash("sha256").update(buf).digest("hex");
    const key = this.objectKey(meta.adapter, sha256, meta.contentType);

    try {
      const head = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        bucket: this.bucket,
        key,
        sha256,
        contentType: meta.contentType,
        sizeBytes: head.ContentLength ?? buf.length,
      };
    } catch (err) {
      if (!isNotFound(err)) throw err;
    }

    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buf,
        ContentType: meta.contentType,
      }),
    );

    return {
      bucket: this.bucket,
      key,
      sha256,
      contentType: meta.contentType,
      sizeBytes: buf.length,
    };
  }

  async get(ref: EvidenceRef): Promise<Readable> {
    const out = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: ref.key }),
    );
    if (!out.Body) {
      throw new Error(`R2 get returned empty body for key ${ref.key}`);
    }
    return out.Body as Readable;
  }

  async exists(sha256: string, adapter?: string): Promise<boolean> {
    const adapters = adapter
      ? [adapter.replace(/[^a-zA-Z0-9._-]+/g, "_") || "unknown"]
      : null;
    if (adapters) {
      for (const name of adapters) {
        for (const ext of ["html", "json"]) {
          try {
            await this.client.send(
              new HeadObjectCommand({
                Bucket: this.bucket,
                Key: `shared/${name}/${sha256}.${ext}`,
              }),
            );
            return true;
          } catch (err) {
            if (!isNotFound(err)) throw err;
          }
        }
      }
      return false;
    }
    const list = await this.client.send(
      new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: "shared/",
        Delimiter: "/",
      }),
    );
    const prefixes = list.CommonPrefixes ?? [];
    for (const cp of prefixes) {
      const prefix = cp.Prefix ?? "";
      const adapterName = prefix.replace(/^shared\//, "").replace(/\/$/, "");
      if (!adapterName) continue;
      for (const ext of ["html", "json"]) {
        try {
          await this.client.send(
            new HeadObjectCommand({
              Bucket: this.bucket,
              Key: `shared/${adapterName}/${sha256}.${ext}`,
            }),
          );
          return true;
        } catch (err) {
          if (!isNotFound(err)) throw err;
        }
      }
    }
    return false;
  }

  async head(ref: EvidenceRef): Promise<EvidenceMeta> {
    const out = await this.client.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: ref.key }),
    );
    return {
      sha256: ref.sha256,
      contentType: ref.contentType,
      sizeBytes: out.ContentLength ?? 0,
      key: ref.key,
      bucket: this.bucket,
    };
  }

  /** Release HTTP connections (call from tests and long-lived workers). */
  disconnect(): void {
    this.client.destroy();
  }
}
