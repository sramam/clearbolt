export interface DatabaseConfig {
  databaseUrl: string;
}

/**
 * `pg` v8+ warns when `sslmode` is prefer/require/verify-ca without explicit
 * libpq-compat opt-in; Neon URLs often use `sslmode=require`.
 */
export function normalizePgDatabaseUrl(connectionString: string): string {
  try {
    const u = new URL(connectionString);
    const ssl = u.searchParams.get("sslmode")?.toLowerCase();
    if (
      ssl &&
      ["prefer", "require", "verify-ca"].includes(ssl) &&
      !u.searchParams.has("uselibpqcompat")
    ) {
      u.searchParams.set("uselibpqcompat", "true");
      return u.toString();
    }
  } catch {
    /* non-URL strings — leave unchanged */
  }
  return connectionString;
}

/** Returns null when DATABASE_URL is missing. */
export function databaseUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig | null {
  const raw = env.DATABASE_URL?.trim();
  if (!raw) return null;
  return { databaseUrl: normalizePgDatabaseUrl(raw) };
}

/** @deprecated Use `databaseUrlFromEnv`. */
export function neonMetadataConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): DatabaseConfig | null {
  return databaseUrlFromEnv(env);
}
