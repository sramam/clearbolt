import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";
import { normalizePgDatabaseUrl } from "./src/config.js";

const pkgRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(pkgRoot, "../..");

for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

/** Migrations use the direct (unpooled) Neon URL when set. */
const migrationUrl =
  process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();

if (!migrationUrl) {
  throw new Error(
    "DATABASE_URL or DATABASE_URL_UNPOOLED must be set for Prisma CLI",
  );
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: normalizePgDatabaseUrl(migrationUrl),
  },
});
