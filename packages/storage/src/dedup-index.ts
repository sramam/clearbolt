import { createHash } from "node:crypto";
import type { DedupKey } from "@clearbolt/core";

export function stableDedupKeyJson(key: DedupKey): string {
  return JSON.stringify(key);
}

export function dedupKeyHash(key: DedupKey): string {
  return createHash("sha256").update(stableDedupKeyJson(key)).digest("hex");
}

export function hostFileName(host: string): string {
  return host.replaceAll(/[^a-zA-Z0-9._-]/g, "_");
}
