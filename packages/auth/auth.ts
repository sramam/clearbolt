/**
 * Better Auth CLI entry (`pnpm exec better-auth generate` from packages/auth).
 * Runtime import: `@clearbolt/auth/server`.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseUrlFromEnv, getPrisma } from "@clearbolt/db";
import dotenv from "dotenv";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}
import { createClearboltAuth } from "./src/server/create-auth.js";

const cfg = databaseUrlFromEnv();
if (!cfg) {
  throw new Error("DATABASE_URL must be set to run better-auth CLI");
}

export const auth = createClearboltAuth(getPrisma(cfg.databaseUrl));
