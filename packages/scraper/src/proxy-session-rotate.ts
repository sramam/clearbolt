/**
 * Decodo sticky sessions expire after `CLEARBOLT_PROXY_SESSION_DURATION_MINUTES`
 * (default 10). Rotate session keys before expiry so proxy usernames get a new
 * `-session-…-sessionduration-N` window.
 */

function envInt(key: string, fallback: number): number {
  const raw = process.env[key]?.trim();
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isNaN(n) ? fallback : n;
}

/** Decodo sticky session lifetime (default 10 minutes). */
export function proxySessionDurationMs(): number {
  const minutes = envInt("CLEARBOLT_PROXY_SESSION_DURATION_MINUTES", 10);
  return Math.max(1, minutes) * 60 * 1000;
}

/** Rotate this many ms before session expiry (default 60s). */
export function proxySessionRotateBufferMs(): number {
  return Math.max(0, envInt("CLEARBOLT_PROXY_SESSION_ROTATE_BUFFER_MS", 60_000));
}

/** Wall-clock window per generation; a new Decodo session key each window. */
export function proxySessionRotateWindowMs(): number {
  return Math.max(60_000, proxySessionDurationMs() - proxySessionRotateBufferMs());
}

/** Monotonic generation counter for session key suffix (`g0`, `g1`, …). */
export function proxySessionGeneration(atMs: number = Date.now()): number {
  return Math.floor(atMs / proxySessionRotateWindowMs());
}

export function proxySessionKeyBase(): string {
  const base = process.env.CLEARBOLT_PROXY_SESSION_ID?.trim();
  return base || "clearbolt";
}

/** Worker slot + generation → unique Decodo sticky session (port hash + time window). */
export function proxySessionKeyForWorker(
  workerIndex: number,
  generation: number = proxySessionGeneration(),
): string {
  return `${proxySessionKeyBase()}-w${workerIndex}-g${generation}`;
}
