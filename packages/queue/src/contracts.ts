export interface EnqueueOpts {
  idempotencyKey?: string;
}

/** @internal Reserved for parallel consumers in pg-boss backend. */
export type ConsumeOpts = Record<string, never>;

export interface Queue {
  enqueue<T>(
    jobName: string,
    payload: T,
    opts?: EnqueueOpts,
  ): Promise<{ jobId: string }>;
  consume<T>(
    jobName: string,
    handler: (payload: T) => Promise<void>,
    opts?: ConsumeOpts,
  ): Disposable;
}

export interface Scheduler {
  schedule(
    name: string,
    cron: string,
    jobName: string,
    payload: unknown,
  ): Promise<void>;
  unschedule(name: string): Promise<void>;
}
