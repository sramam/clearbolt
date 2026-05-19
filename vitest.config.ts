import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { defineConfig } from "vitest/config";

/** Same order as `apps/cli/src/bind-storage.ts` — tests see manual secrets (e.g. OpenRouter) without exporting in shell. */
const repoRoot = dirname(fileURLToPath(import.meta.url));
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  dotenv.config({ path: join(repoRoot, name) });
}

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "packages/**/*.test.ts",
      "apps/**/*.test.ts",
      "scripts/**/*.test.ts",
    ],
    coverage: { provider: "v8", reporter: ["text"], enabled: false },
    reporters: ["default", "./scripts/vitest-fixture-recover-hint.mjs"],
  },
});
