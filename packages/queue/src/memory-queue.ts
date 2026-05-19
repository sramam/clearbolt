import { randomUUID } from "node:crypto";
import type { ConsumeOpts, EnqueueOpts, Queue } from "./contracts.js";

/**
 * In-process queue for V0 / tests. Handlers run synchronously from `enqueue`
 * when a consumer is already registered; otherwise payloads wait in a backlog.
 */
export class MemoryQueue implements Queue {
  private readonly handlers = new Map<
    string,
    (payload: unknown) => Promise<void>
  >();
  private readonly backlog = new Map<string, unknown[]>();
  private readonly idempotencySeen = new Map<string, Set<string>>();

  async enqueue<T>(
    jobName: string,
    payload: T,
    opts?: EnqueueOpts,
  ): Promise<{ jobId: string }> {
    if (opts?.idempotencyKey) {
      const set = this.idempotencySeen.get(jobName) ?? new Set();
      if (set.has(opts.idempotencyKey)) {
        return { jobId: `idempotent:${opts.idempotencyKey}` };
      }
      set.add(opts.idempotencyKey);
      this.idempotencySeen.set(jobName, set);
    }

    const jobId = randomUUID();
    const h = this.handlers.get(jobName);
    if (h) {
      await h(payload);
    } else {
      const q = this.backlog.get(jobName) ?? [];
      q.push(payload);
      this.backlog.set(jobName, q);
    }
    return { jobId };
  }

  consume<T>(
    jobName: string,
    handler: (payload: T) => Promise<void>,
    _opts?: ConsumeOpts,
  ): Disposable {
    this.handlers.set(jobName, handler as (p: unknown) => Promise<void>);
    const pending = this.backlog.get(jobName);
    if (pending?.length) {
      this.backlog.delete(jobName);
      void (async () => {
        for (const p of pending) {
          await (handler as (arg: unknown) => Promise<void>)(p);
        }
      })();
    }
    return {
      [Symbol.dispose]: () => {
        this.handlers.delete(jobName);
      },
    };
  }
}
