/** V0 in-memory per-host throttle (serializes concurrent callers per host). */
const lastAt = new Map<string, number>();
const chains = new Map<string, Promise<void>>();

export async function throttleHost(
  host: string,
  minGapMs: number,
): Promise<void> {
  const prev = chains.get(host) ?? Promise.resolve();
  const job = prev.then(async () => {
    const now = Date.now();
    const last = lastAt.get(host) ?? 0;
    const wait = Math.max(0, minGapMs - (now - last));
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt.set(host, Date.now());
  });
  chains.set(
    host,
    job.then(
      () => undefined,
      () => undefined,
    ),
  );
  await job;
}
