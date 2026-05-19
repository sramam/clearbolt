import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { NextConfig } from "next";

const monorepoRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: path.join(monorepoRoot, name) });
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    "@clearbolt/auth",
    "@clearbolt/core",
    "@clearbolt/db",
    "@clearbolt/dedup",
    "@clearbolt/scraper",
    "@clearbolt/storage",
    "@clearbolt/storage-neon",
    "@clearbolt/storage-r2",
  ],
  serverExternalPackages: [
    "pg",
    "@prisma/adapter-pg",
    "@prisma/client",
    "playwright",
    "playwright-core",
  ],
};

export default nextConfig;
