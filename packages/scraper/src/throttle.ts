/** V0 in-memory per-host throttle (placeholder AIMD — single slot). */
const lastAt = new Map<string, number>();

export async function throttleHost(
  host: string,
  minGapMs: number,
): Promise<void> {
  const now = Date.now();
  const last = lastAt.get(host) ?? 0;
  const wait = Math.max(0, minGapMs - (now - last));
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt.set(host, Date.now());
}
