import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { normalizePgDatabaseUrl } from "./config.js";
import { PrismaClient } from "./generated/prisma/client.js";

export type { PrismaClient };

let pool: Pool | null = null;
let prisma: PrismaClient | null = null;

/** Shared Prisma client for the app (metadata, auth, pipeline). One pool per process. */
export function getPrisma(databaseUrl: string): PrismaClient {
  if (!prisma) {
    pool = new Pool({
      connectionString: normalizePgDatabaseUrl(databaseUrl),
    });
    prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  }
  return prisma;
}

export async function disconnectPrisma(): Promise<void> {
  await prisma?.$disconnect();
  await pool?.end();
  prisma = null;
  pool = null;
}
