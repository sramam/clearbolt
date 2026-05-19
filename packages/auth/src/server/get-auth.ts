import { databaseUrlFromEnv, getPrisma } from "@clearbolt/db";
import type { betterAuth } from "better-auth";
import { createClearboltAuth } from "./create-auth.js";

let cached: ReturnType<typeof betterAuth> | null = null;

/** Lazily create the better-auth instance when DATABASE_URL + BETTER_AUTH_SECRET are set. */
export function getClearboltAuth(): ReturnType<typeof betterAuth> | null {
  if (cached) return cached;
  const cfg = databaseUrlFromEnv();
  if (!cfg) return null;
  if (!process.env.BETTER_AUTH_SECRET?.trim()) return null;
  try {
    cached = createClearboltAuth(getPrisma(cfg.databaseUrl));
    return cached;
  } catch {
    return null;
  }
}

export function isAuthConfigured(): boolean {
  return getClearboltAuth() !== null;
}
