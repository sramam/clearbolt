#!/usr/bin/env node
/**
 * CI gate: live OpenRouter dedup tests require OPENROUTER_API_KEY.
 * Local runs without the key skip live tests via vitest describe.skipIf.
 */
if (!process.env.CI) process.exit(0);

const key = process.env.OPENROUTER_API_KEY?.trim();
if (key) {
  console.log("[verify:openrouter-ci] OPENROUTER_API_KEY is set.");
  process.exit(0);
}

console.error(
  "[verify:openrouter-ci] OPENROUTER_API_KEY is required in CI for live dedup tests.",
);
console.error(
  "Add repository secret OPENROUTER_API_KEY (Settings → Secrets and variables → Actions).",
);
console.error(
  "Create a key at https://openrouter.ai/keys and pin CLEARBOLT_DEDUP_LLM_MODEL in ci.yml if needed.",
);
process.exit(1);
