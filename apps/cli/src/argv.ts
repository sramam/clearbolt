/** Catalog subcommand flags that consume the next argv token. */
export const CATALOG_VALUED_FLAGS = [
  "--pages",
  "--ingest",
  "--max-listings",
  "--discover-out",
  "--refs-file",
  "--source",
] as const;

/** Positional args only — skips boolean flags and valued-flag arguments. */
export function positionalArgs(
  args: string[],
  valuedFlags: readonly string[] = CATALOG_VALUED_FLAGS,
): string[] {
  const valued = new Set(valuedFlags);
  const out: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (valued.has(a)) {
      i++;
      continue;
    }
    if (a.startsWith("--")) continue;
    out.push(a);
  }
  return out;
}
