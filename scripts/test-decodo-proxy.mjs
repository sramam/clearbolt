#!/usr/bin/env node
import { execFile } from "node:child_process";
/**
 * Smoke-test Decodo proxy env (CLEARBOLT_PROXY_*). Loads .env.cloud.local → .env.dev → .env
 * Usage: pnpm proxy:test
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { config } from "dotenv";

const execFileAsync = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const name of [".env.cloud.local", ".env.dev", ".env"]) {
  config({ path: join(root, name) });
}

function buildDecodoUsername(base, sessionKey) {
  const country = (process.env.CLEARBOLT_PROXY_COUNTRY ?? "us").toLowerCase();
  const duration = Number.parseInt(
    process.env.CLEARBOLT_PROXY_SESSION_DURATION_MINUTES ?? "10",
    10,
  );
  let user = base.startsWith("user-") ? base : `user-${base}`;
  if (!user.includes(`-country-${country}`))
    user = `${user}-country-${country}`;
  if (!user.includes("-session-")) {
    user = `${user}-session-${sessionKey}-sessionduration-${duration}`;
  }
  return user;
}

function parseEndpointLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  try {
    const u = new URL(trimmed);
    return {
      host: u.hostname,
      port: u.port || "10001",
      baseUser: decodeURIComponent(u.username),
      pass: decodeURIComponent(u.password),
    };
  } catch {
    return null;
  }
}

function firstEndpointFromFile(filePath) {
  const resolved = resolve(root, filePath);
  let content;
  try {
    content = readFileSync(resolved, "utf8");
  } catch (err) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ENOENT"
    ) {
      console.error(
        `Missing ${filePath} — copy proxy-endpoints.example.txt to proxy-endpoints.local.txt and paste your Decodo URLs.`,
      );
      process.exit(1);
    }
    throw err;
  }
  for (const line of content.split(/\r?\n/)) {
    const ep = parseEndpointLine(line);
    if (ep) return ep;
  }
  return null;
}

let host;
let port;
let baseUser;
let pass;

const endpointsFile = process.env.CLEARBOLT_PROXY_ENDPOINTS_FILE?.trim();
if (endpointsFile) {
  const ep = firstEndpointFromFile(endpointsFile);
  if (!ep) {
    console.error(
      `CLEARBOLT_PROXY_ENDPOINTS_FILE=${endpointsFile} has no valid proxy lines`,
    );
    process.exit(1);
  }
  ({ host, port, baseUser, pass } = ep);
} else {
  const raw = process.env.CLEARBOLT_PROXY_RESIDENTIAL?.trim();
  if (!raw) {
    console.error(
      "Set CLEARBOLT_PROXY_RESIDENTIAL or CLEARBOLT_PROXY_ENDPOINTS_FILE in .env.cloud.local",
    );
    process.exit(1);
  }
  const u = new URL(raw);
  host = u.hostname;
  port = u.port || "10001";
  baseUser = decodeURIComponent(u.username);
  pass = decodeURIComponent(u.password);
}

const sessionId =
  process.env.CLEARBOLT_PROXY_SESSION_ID?.trim() ?? "clearbolt-test";
const username =
  process.env.CLEARBOLT_PROXY_USERNAME_STYLE?.trim() === "decodo"
    ? buildDecodoUsername(baseUser, sessionId)
    : baseUser;

console.log("proxy gateway:", `${host}:${port}`);
if (endpointsFile) console.log("endpoints file:", endpointsFile);
console.log("username:", username);

const { stdout, stderr } = await execFileAsync(
  "curl",
  [
    "-sS",
    "-U",
    `${username}:${pass}`,
    "-x",
    `${host}:${port}`,
    "https://ip.decodo.com/json",
  ],
  { maxBuffer: 1024 * 1024 },
);
if (stderr) console.error(stderr);
console.log(stdout.trim());
