import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ServiceException,
} from "@aws-sdk/client-s3";
import type { R2EvidenceStoreConfig } from "./config.js";

function objectKey(adapter: string, externalId: string): string {
  const safeId = externalId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `listing-ingest-state/${adapter}/${safeId}/state.json`;
}

function isNotFound(err: unknown): boolean {
  const e = err as S3ServiceException;
  return e?.name === "NotFound" || e?.$metadata?.httpStatusCode === 404;
}

/** Per-listing ingest run state JSON at a stable R2 key (one prefix per listing). */
export class R2ListingIngestStateStore {
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

  async getJson(adapter: string, externalId: string): Promise<string | null> {
    const Key = objectKey(adapter, externalId);
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key }),
      );
      return (await res.Body?.transformToString("utf8")) ?? null;
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async putJson(
    adapter: string,
    externalId: string,
    body: string,
  ): Promise<void> {
    const Key = objectKey(adapter, externalId);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key,
        Body: body,
        ContentType: "application/json",
      }),
    );
  }
}
