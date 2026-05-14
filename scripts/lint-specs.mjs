#!/usr/bin/env node
/**
 * V0 advisory: ensure spec markdown files declare validation / falsifiability sections.
 * Exit 0 always for V0; print warnings on missing sections.
 */
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const SECTION_RE = /##\s+Validation criteria\b/i;
const FALS_RE = /##\s+Falsifiability criteria\b/i;

async function* walkMarkdown(dir, rel = "") {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    const r = join(rel, e.name);
    if (e.name === "node_modules" || e.name === "dist" || e.name === ".git")
      continue;
    if (e.isDirectory()) yield* walkMarkdown(p, r);
    else if (e.name.endsWith(".md")) yield { path: p, rel: r };
  }
}

function hasCriteria(content, isAdr) {
  if (SECTION_RE.test(content)) return true;
  if (isAdr && FALS_RE.test(content)) return true;
  return false;
}

async function main() {
  const issues = [];
  for await (const { path, rel } of walkMarkdown(ROOT)) {
    const r = relative(ROOT, path);
    if (
      !r.startsWith("docs/") &&
      !r.startsWith("packages/") &&
      !r.startsWith("apps/") &&
      r !== "agents.md"
    )
      continue;
    if (r.includes("node_modules")) continue;
    const content = await readFile(path, "utf8");
    const isAdr =
      r.startsWith("docs/decisions/") &&
      /^\d{4}-/.test(r.split("/").pop() ?? "");
    if (!hasCriteria(content, isAdr)) issues.push(r);
  }
  if (issues.length) {
    console.warn(
      "[lint:specs] advisory — missing ## Validation criteria (or ADR ## Falsifiability criteria):",
    );
    for (const i of issues.sort()) console.warn(`  - ${i}`);
  } else {
    console.log("[lint:specs] ok — all scanned specs have criteria sections.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
