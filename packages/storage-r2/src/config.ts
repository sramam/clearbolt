export interface R2EvidenceStoreConfig {
  bucket: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint: string;
}

export function defaultR2Endpoint(accountId: string): string {
  return `https://${accountId}.r2.cloudflarestorage.com`;
}

/** Returns null when required R2 env vars are missing. */
export function r2EvidenceConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): R2EvidenceStoreConfig | null {
  const bucket = env.R2_EVIDENCE_BUCKET?.trim();
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!bucket || !accountId || !accessKeyId || !secretAccessKey) {
    return null;
  }
  const endpoint = env.R2_ENDPOINT?.trim() || defaultR2Endpoint(accountId);
  return { bucket, accountId, accessKeyId, secretAccessKey, endpoint };
}
