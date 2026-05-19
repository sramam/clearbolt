import { readFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dumpRunEnv } from "../src/dump-env.js";

describe("dumpRunEnv", () => {
  const env = process.env;

  afterEach(() => {
    process.env = env;
  });

  it("redacts secret-like keys", async () => {
    process.env.CLEARBOLT_TEST_PLAIN = "visible";
    process.env.CLEARBOLT_PROXY_SESSION_ID = "retry-test-session";
    const dir = await mkdtemp(join(tmpdir(), "cb-env-dump-"));
    const path = join(dir, "dump.json");
    await dumpRunEnv({
      outPath: path,
      argv: ["catalog", "--retry-failures-only"],
    });
    const raw = await readFile(path, "utf8");
    const data = JSON.parse(raw) as { env: Record<string, string> };
    expect(data.env.CLEARBOLT_TEST_PLAIN).toBe("visible");
    expect(data.env.CLEARBOLT_PROXY_SESSION_ID).toBe("retry-test-session");
    expect(data.resolved).toBeDefined();
  });
});
