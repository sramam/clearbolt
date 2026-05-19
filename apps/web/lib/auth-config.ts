/** Env-only checks safe for Edge middleware (no Prisma / auth init). */

export function isBetterAuthConfigured(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const secret = env.BETTER_AUTH_SECRET?.trim();
  return Boolean(
    env.DATABASE_URL?.trim() && secret && secret.length >= 32,
  );
}

/** Local walking skeleton: dev user id when better-auth is not wired. */
export function hasDevAuthBypass(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return Boolean(
    env.CLEARBOLT_DEV_USER_ID?.trim() && !isBetterAuthConfigured(env),
  );
}
