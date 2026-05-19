#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
/**
 * Provision Neon (one project per env) + Cloudflare R2 + Resend (OTP email) per env.
 * Uses repo devDependencies: neonctl, wrangler. Auth: `neonctl auth`, `wrangler login`.
 * Resend: `RESEND_BOOTSTRAP_API_KEY` or `RESEND_API_KEY` (full_access) in `.env.cloud.local`.
 *
 * Usage:
 *   pnpm cloud:provision -- --env dev
 *   pnpm cloud:provision -- --env staging --dry-run
 *   pnpm cloud:provision -- --env prod --neon-only
 *   pnpm cloud:provision -- --env dev --resend-only
 *   pnpm cloud:provision -- --env dev --write
 *
 * Env:
 *   NEON_ORG_ID          — optional; passed to `neonctl projects create --org-id`
 *   NEON_REGION_ID       — default aws-us-east-2
 *   CLOUDFLARE_ACCOUNT_ID — required for R2 (non-dry-run); pick from `wrangler whoami`
 *   R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY — optional; Wrangler cannot create them.
 *     Add after Dashboard → R2 → Manage R2 API Tokens; with `--write`, both are
 *     copied into the output file if present in env (e.g. from `.env.cloud.local`).
 *   RESEND_BOOTSTRAP_API_KEY — full_access key used only to mint `clearbolt-<env>` sending keys.
 *   RESEND_API_KEY — bootstrap fallback; also reused when `clearbolt-<env>` already exists.
 *   RESEND_FROM_DOMAIN / AUTH_EMAIL_FROM — optional; dev defaults to onboarding@resend.dev.
 *
 * Optional files at repo root (gitignored), loaded via **dotenv** in order:
 * `.env.cloud.local`, `.env.dev`, `.env`. Later files do not override keys already
 * set (shell env wins; same as dotenv defaults).
 */
import dotenv from "dotenv";
import {
  defaultAuthEmailFrom,
  provisionResendApiKey,
  resendApiKeyName,
} from "./lib/resend-provision.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function loadRepoEnvOptional() {
  for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
    dotenv.config({ path: join(root, name) });
  }
}

/** @param {string} key @param {string} value */
function envAssign(key, value) {
  const v = String(value);
  if (/[\s#&|;<>`$"'\\]/.test(v)) {
    return `${key}="${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return `${key}=${v}`;
}

/** @param {string[]} args */
function parseArgs(args) {
  let env = "dev";
  let dryRun = false;
  let neonOnly = false;
  let r2Only = false;
  let resendOnly = false;
  let writePath = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--neon-only") neonOnly = true;
    else if (a === "--r2-only") r2Only = true;
    else if (a === "--resend-only") resendOnly = true;
    else if (a === "--write") {
      const next = args[i + 1];
      if (next && !next.startsWith("-")) {
        writePath = next;
        i++;
      } else {
        writePath = "__default__";
      }
    } else if (a.startsWith("--env=")) env = a.slice("--env=".length);
    else if (a === "--env") {
      const next = args[++i];
      if (!next) throw new Error("--env requires a value");
      env = next;
    } else if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
    else throw new Error(`Unexpected argument: ${a}`);
  }

  const onlyFlags = [neonOnly, r2Only, resendOnly].filter(Boolean).length;
  if (onlyFlags > 1) {
    throw new Error("Use only one of --neon-only, --r2-only, --resend-only");
  }
  return { env, dryRun, neonOnly, r2Only, resendOnly, writePath, help };
}

/** @param {string} raw */
function normalizeEnv(raw) {
  const s = String(raw || "dev").toLowerCase();
  if (s === "dev" || s === "development") return "dev";
  if (s === "stage" || s === "staging") return "staging";
  if (s === "prod" || s === "production") return "prod";
  throw new Error(
    `Unknown --env "${raw}" (use dev, staging/stage, or prod/production)`,
  );
}

/** @param {'dev'|'staging'|'prod'} tag */
function labels(tag) {
  const project = `clearbolt-${tag}`;
  const evidence = `clearbolt-evidence-${tag}`;
  const wiki = `clearbolt-wiki-${tag}`;
  return { project, evidence, wiki };
}

/**
 * @param {string} cmd
 * @param {string[]} argv
 * @param {{ env?: NodeJS.ProcessEnv }} [opts]
 */
function run(cmd, argv, opts = {}) {
  const r = spawnSync(cmd, argv, {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...opts.env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = (r.stdout ?? "").trimEnd();
  const stderr = (r.stderr ?? "").trimEnd();
  return {
    status: r.status ?? 1,
    stdout,
    stderr,
    error: r.error,
  };
}

/** @param {string[]} neonArgs */
function neonctl(...neonArgs) {
  return run("pnpm", ["exec", "neonctl", "--no-color", ...neonArgs]);
}

/** @param {string[]} wranglerArgs */
function wrangler(wranglerArgs, extraEnv = {}) {
  return run("pnpm", ["exec", "wrangler", ...wranglerArgs], {
    env: { ...process.env, ...extraEnv },
  });
}

/** @param {string} out */
function extractPostgresUrl(out) {
  const lines = out.split(/\r?\n/);
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("postgresql://") || t.startsWith("postgres://")) return t;
  }
  throw new Error(
    `Could not find postgres connection string in neonctl output:\n${out}`,
  );
}

/** @param {string} stdout */
function parseJsonSafe(stdout) {
  const t = stdout.trim();
  if (!t) throw new Error("Empty JSON from neonctl");
  return JSON.parse(t);
}

/**
 * @param {'dev'|'staging'|'prod'} tag
 * @param {{ dryRun: boolean }} opts
 */
function provisionNeon(tag, opts) {
  const { project: projectName } = labels(tag);
  const region = process.env.NEON_REGION_ID?.trim() || "aws-us-east-2";
  const orgId = process.env.NEON_ORG_ID?.trim();

  if (opts.dryRun) {
    console.log(
      `[dry-run] neon: ensure project "${projectName}" (region ${region}${orgId ? `, org ${orgId}` : ""})`,
    );
    console.log(
      "[dry-run] neon: connection-string <default-branch> --pooled / unpooled",
    );
    return {
      projectId: "<dry-run>",
      branch: "<dry-run>",
      pooled: "postgresql://…",
      direct: "postgresql://…",
    };
  }

  const list = neonctl("projects", "list", "-o", "json");
  if (list.status !== 0) {
    console.error(list.stderr || list.stdout);
    process.exit(list.status);
  }
  let projectId;
  try {
    const data = parseJsonSafe(list.stdout);
    const found = data.projects?.find((p) => p.name === projectName);
    projectId = found?.id;
  } catch (e) {
    console.error("Failed to parse neonctl projects list JSON:", e);
    process.exit(1);
  }

  if (!projectId) {
    const createArgs = [
      "projects",
      "create",
      "--name",
      projectName,
      "--region-id",
      region,
      "-o",
      "json",
    ];
    if (orgId) createArgs.push("--org-id", orgId);

    console.log(`[neon] creating project "${projectName}" …`);
    const created = neonctl(...createArgs);
    if (created.status !== 0) {
      console.error(created.stderr || created.stdout);
      process.exit(created.status);
    }
    let parsed;
    try {
      parsed = parseJsonSafe(created.stdout);
    } catch (e) {
      console.error("Failed to parse neonctl projects create JSON:", e);
      console.error(created.stdout);
      process.exit(1);
    }
    projectId = parsed.project?.id ?? parsed.id;
    if (!projectId) {
      console.error("Unexpected create response:", created.stdout);
      process.exit(1);
    }
    console.log(`[neon] created project "${projectName}" (id ${projectId})`);
  } else {
    console.log(`[neon] using existing project ${projectId} (${projectName})`);
  }

  const branches = neonctl(
    "branches",
    "list",
    "--project-id",
    projectId,
    "-o",
    "json",
  );
  if (branches.status !== 0) {
    console.error(branches.stderr || branches.stdout);
    process.exit(branches.status);
  }
  let branchName;
  try {
    const listB = JSON.parse(branches.stdout);
    const def = listB.find((b) => b.default === true);
    branchName = def?.name ?? listB[0]?.name;
  } catch {
    console.error("Failed to parse branches list:", branches.stdout);
    process.exit(1);
  }
  if (!branchName) {
    console.error("No branches on project", projectId);
    process.exit(1);
  }

  const pooledR = neonctl(
    "connection-string",
    branchName,
    "--project-id",
    projectId,
    "--pooled",
  );
  const directR = neonctl(
    "connection-string",
    branchName,
    "--project-id",
    projectId,
  );
  if (pooledR.status !== 0 || directR.status !== 0) {
    console.error(pooledR.stderr || directR.stdout);
    console.error(directR.stderr || directR.stdout);
    process.exit(1);
  }

  return {
    projectId,
    branch: branchName,
    pooled: extractPostgresUrl(pooledR.stdout),
    direct: extractPostgresUrl(directR.stdout),
  };
}

/**
 * @param {'dev'|'staging'|'prod'} tag
 * @param {{ dryRun: boolean }} opts
 */
function provisionR2(tag, opts) {
  const { evidence, wiki } = labels(tag);
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (opts.dryRun) {
    console.log(`[dry-run] r2: ensure buckets "${evidence}", "${wiki}"`);
    return;
  }

  if (!accountId) {
    console.error(
      "CLOUDFLARE_ACCOUNT_ID is required for R2 (set in env, or use --dry-run / --neon-only).",
    );
    console.error("Hint: `pnpm exec wrangler whoami` lists accounts and IDs.");
    process.exit(1);
  }

  const extra = { CLOUDFLARE_ACCOUNT_ID: accountId };

  for (const name of [evidence, wiki]) {
    const info = wrangler(["r2", "bucket", "info", name, "--json"], extra);
    if (info.status === 0) {
      console.log(`[r2] bucket exists: ${name}`);
      continue;
    }
    console.log(`[r2] creating bucket ${name} …`);
    const cr = wrangler(["r2", "bucket", "create", name], extra);
    if (cr.status !== 0) {
      console.error(cr.stderr || cr.stdout);
      process.exit(cr.status);
    }
    console.log(`[r2] created: ${name}`);
  }
}

/**
 * @param {'dev'|'staging'|'prod'} tag
 * @param {{ dryRun: boolean }} opts
 */
async function provisionResend(tag, opts) {
  const keyName = resendApiKeyName(tag);
  if (opts.dryRun) {
    console.log(
      `[dry-run] resend: ensure sending API key "${keyName}" (sending_access)`,
    );
    const from = defaultAuthEmailFrom(tag);
    if (from) console.log(`[dry-run] resend: AUTH_EMAIL_FROM=${from}`);
    return { apiKey: "re_…", from, skipped: false };
  }

  const bootstrap =
    process.env.RESEND_BOOTSTRAP_API_KEY?.trim() ||
    process.env.RESEND_API_KEY?.trim();
  if (!bootstrap) {
    console.warn(
      "[resend] skipped: set RESEND_BOOTSTRAP_API_KEY or RESEND_API_KEY (full_access) in .env.cloud.local",
    );
    console.warn(
      "       One-time: https://resend.com/api-keys or `resend login` then export the key.",
    );
    return {
      apiKey: process.env.RESEND_API_KEY?.trim() || null,
      from: defaultAuthEmailFrom(tag),
      skipped: true,
    };
  }

  try {
    const result = await provisionResendApiKey(tag, {
      dryRun: false,
      bootstrapKey: bootstrap,
      existingSendingKey: process.env.RESEND_API_KEY,
    });
    if (result.skipped) {
      console.warn("[resend] skipped (no bootstrap key)");
    } else if (result.created) {
      console.log(`[resend] created API key "${keyName}" (sending_access)`);
    } else if (result.exists) {
      if (result.apiKey) {
        console.log(
          `[resend] API key "${keyName}" already exists; reusing RESEND_API_KEY from env`,
        );
      } else {
        console.warn(
          `[resend] API key "${keyName}" already exists but token is not retrievable.`,
        );
        console.warn(
          "       Set RESEND_API_KEY in .env.cloud.local or delete the key in Resend and re-run.",
        );
      }
    }
    return {
      apiKey: result.apiKey,
      from: result.from,
      skipped: result.skipped,
    };
  } catch (e) {
    console.error("[resend] failed:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

async function main() {
  loadRepoEnvOptional();

  let parsed;
  try {
    // pnpm forwards the `--` separator to the script (e.g. `pnpm cloud:provision -- --env dev`)
    const argv = process.argv.slice(2).filter((a) => a !== "--");
    parsed = parseArgs(argv);
  } catch (e) {
    console.error(String(e?.message || e));
    process.exit(1);
  }

  if (parsed.help) {
    console.log(`provision-cloud-env.mjs — Neon + R2 + Resend per environment

Flags:
  --env dev|staging|stage|prod   Target environment (default: dev)
  --dry-run                      Print actions only (no API calls)
  --neon-only                    Skip R2 and Resend
  --r2-only                      Skip Neon and Resend
  --resend-only                  Skip Neon and R2
  --write [path]                 Write env snippet to path (default: .env.cloud.<env>)
  -h, --help

Resend:
  Put a full_access key in RESEND_BOOTSTRAP_API_KEY (or RESEND_API_KEY) in .env.cloud.local.
  The script creates clearbolt-<env> (sending_access) and writes RESEND_API_KEY + AUTH_EMAIL_FROM.

Examples:
  pnpm cloud:provision -- --env dev --dry-run
  pnpm cloud:provision -- --env dev --write
  pnpm cloud:provision -- --env dev --resend-only --write
`);
    process.exit(0);
  }

  const tag = normalizeEnv(parsed.env);
  const { project, evidence, wiki } = labels(tag);

  console.log(`\n=== Clearbolt cloud provision (${tag}) ===\n`);
  console.log(`Neon project name: ${project}`);
  console.log(`R2 buckets:        ${evidence}, ${wiki}`);
  console.log(`Resend API key:    ${resendApiKeyName(tag)}\n`);

  let neon = {
    projectId: "",
    branch: "",
    pooled: "",
    direct: "",
  };

  let resend = { apiKey: null, from: null, skipped: true };

  if (!parsed.r2Only && !parsed.resendOnly) {
    neon = provisionNeon(tag, { dryRun: parsed.dryRun });
  }

  if (!parsed.neonOnly && !parsed.resendOnly) {
    provisionR2(tag, { dryRun: parsed.dryRun });
  }

  if (!parsed.neonOnly && !parsed.r2Only) {
    resend = await provisionResend(tag, { dryRun: parsed.dryRun });
  }

  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";

  const lines = [
    `# Clearbolt cloud — ${tag} (gitignored; from pnpm cloud:provision)`,
  ];

  if (!parsed.r2Only && !parsed.resendOnly) {
    lines.push(
      "# Neon",
      envAssign("NEON_PROJECT_ID", neon.projectId),
      envAssign("NEON_BRANCH", neon.branch),
      envAssign("DATABASE_URL", neon.pooled),
      envAssign("DATABASE_URL_UNPOOLED", neon.direct),
      "",
    );
  } else if (parsed.resendOnly) {
    lines.push(
      `# Neon skipped (--resend-only). Expected project: ${project}.`,
      "",
    );
  } else if (parsed.r2Only) {
    lines.push(
      `# Neon skipped (--r2-only). Run without it to create ${project} and emit URLs.`,
      "",
    );
  }

  if (!parsed.neonOnly && !parsed.r2Only) {
    lines.push("# Resend (email OTP)");
    if (resend.apiKey) {
      lines.push(envAssign("RESEND_API_KEY", resend.apiKey));
    } else {
      lines.push(
        "# RESEND_API_KEY=  # run with RESEND_BOOTSTRAP_API_KEY set, or paste sending key",
      );
    }
    if (resend.from) {
      lines.push(envAssign("AUTH_EMAIL_FROM", resend.from));
    } else {
      lines.push(
        "# AUTH_EMAIL_FROM=  # set RESEND_FROM_DOMAIN or AUTH_EMAIL_FROM for staging/prod",
      );
    }
    lines.push("");
  }

  if (!parsed.neonOnly && !parsed.resendOnly) {
    const r2Access = process.env.R2_ACCESS_KEY_ID?.trim();
    const r2Secret = process.env.R2_SECRET_ACCESS_KEY?.trim();
    lines.push(
      "# Cloudflare R2",
      accountId
        ? envAssign("CLOUDFLARE_ACCOUNT_ID", accountId)
        : "# CLOUDFLARE_ACCOUNT_ID=",
      envAssign("R2_EVIDENCE_BUCKET", evidence),
      envAssign("R2_WIKI_BUCKET", wiki),
      "",
    );
    if (r2Access && r2Secret) {
      lines.push(
        "# R2 S3 credentials (copied from env — e.g. .env.cloud.local)",
        envAssign("R2_ACCESS_KEY_ID", r2Access),
        envAssign("R2_SECRET_ACCESS_KEY", r2Secret),
      );
    } else {
      lines.push(
        "# R2 S3 credentials: Cloudflare Dashboard → R2 → Manage R2 API Tokens.",
        "# Wrangler cannot mint these keys. After you create a token, add both vars",
        "# to .env.cloud.local, then re-run with --write to embed them here.",
        "# R2_ACCESS_KEY_ID=",
        "# R2_SECRET_ACCESS_KEY=",
      );
    }
  } else if (parsed.neonOnly) {
    lines.push(
      `# R2 skipped (--neon-only). Expected buckets: ${evidence}, ${wiki}`,
      "",
    );
  } else if (parsed.resendOnly) {
    lines.push(
      `# R2 skipped (--resend-only). Expected buckets: ${evidence}, ${wiki}`,
      "",
    );
  }

  const body = `${lines.join("\n")}\n`;

  if (parsed.writePath) {
    const outFile =
      parsed.writePath === "__default__"
        ? join(root, `.env.cloud.${tag}`)
        : join(root, parsed.writePath);
    writeFileSync(outFile, body, { encoding: "utf8" });
    console.log(`\nWrote ${outFile} (keep local; never commit).`);
    if (!parsed.neonOnly) {
      const ak = process.env.R2_ACCESS_KEY_ID?.trim();
      const sk = process.env.R2_SECRET_ACCESS_KEY?.trim();
      if (!ak || !sk) {
        console.log(
          "Tip: add R2_ACCESS_KEY_ID + R2_SECRET_ACCESS_KEY to .env.cloud.local (R2 → Manage R2 API Tokens), then re-run with --write to embed them.\n",
        );
      }
    }
  } else {
    console.log(
      "\n--- Paste into a gitignored env file (or re-run with --write) ---\n",
    );
    console.log(body);
  }

  if (parsed.dryRun) {
    console.log("[dry-run] done (no resources created).\n");
  } else {
    console.log("Done.\n");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
