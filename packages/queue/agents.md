# `packages/queue`

> Runtime: **node** (Fly.io). CF Workers can enqueue via Neon HTTP driver writing to pg-boss tables.

Queue + scheduler contracts. Backends switch based on phase.

## Contracts

```ts
interface Queue {
  enqueue<T>(jobName: string, payload: T, opts?: EnqueueOpts): Promise<{ jobId: string }>;
  consume<T>(jobName: string, handler: (payload: T) => Promise<void>, opts?: ConsumeOpts): Disposable;
}

interface Scheduler {
  schedule(name: string, cron: string, jobName: string, payload: unknown): Promise<void>;
  unschedule(name: string): Promise<void>;
}
```

## Backends

### V0: in-memory + node-cron

- `MemoryQueue` — fires consumers in-process.
- `NodeCronScheduler` — `node-cron` for periodic jobs.
- Sufficient for the V0 walking skeleton.

### V1+: pg-boss on Neon (Fly worker consumes)

- `PgBossQueue` — pg-boss tables in Neon Postgres.
- Producers: anywhere with DB access (Fly write API + CF Workers via Neon HTTP driver).
- Consumers: Fly worker processes (long-lived).
- Scheduler: pg-boss has built-in cron support; use it.

### V2+ optional: Cloudflare Queues

- `CloudflareQueue` — for CF-side producers and consumers if we want to move some workloads off pg-boss for higher throughput.
- Same `Queue` contract.

## Job catalog (V1)

- `scrape-saved-search` — produced by scheduler, consumed by scraper worker.
- `scrape-detail` — produced by `scrape-saved-search`, consumed by scraper worker.
- `dedup-source-record` — produced after each new `SourceRecord`, consumed by dedup worker.
- `wiki-ingest` — produced after each new `SourceRecord`, `WorkspaceCapture`, or `Transcript`, consumed by wiki maintainer.
- `wiki-lint` — periodic, scheduled per workspace.
- `capture-process` — produced by `POST /api/captures`, consumed by capture worker.
- `transcribe` — produced by user action or wiki maintainer, consumed by transcribe worker.
- `notify-digest` — periodic per workspace.
- `enrich-broker` — produced when a new broker entity is created, consumed by enrichment worker.

## Where it runs

- **Producers**: anywhere (Fly Node, CF Workers).
- **Consumers**: Fly machines.
- **Scheduler tick**: Fly (single-leader pg-boss handles concurrency).

## Validation criteria

### Conformance
- **Given** any `Queue` backend, **when** the conformance suite at `packages/queue/src/conformance/queue.suite.ts` runs, **then** all assertions pass: enqueue + consume round-trips, at-least-once delivery, structured failure on handler throw, retry with backoff, dead-letter after max-attempts. Coverage: integration. Test: `packages/queue/tests/conformance.test.ts` (TBD V1).
- **Given** any `Scheduler` backend, **when** a cron is scheduled and the configured time elapses, **then** exactly one job is enqueued per fire window. Coverage: integration. Test: `packages/queue/src/conformance/scheduler.suite.ts` (TBD V1).

### Idempotency
- **Given** the same `(jobName, payload)` enqueued twice within a configured de-dup window with an idempotency key, **when** consumed, **then** the handler runs at most once. Coverage: integration. Test: `packages/queue/tests/idempotency-key.test.ts` (TBD V1).

### Producer cross-runtime
- **Given** a CF Worker producer using the Neon HTTP driver, **when** it enqueues a `pg-boss` job, **then** the job is consumed correctly by the Fly worker. Coverage: integration. Test: `packages/queue/tests/cf-producer-fly-consumer.test.ts` (TBD V1).

### Job-catalog completeness
- **Given** the V1 job catalog above, **when** the V1 walking-skeleton smoke runs, **then** each catalog job is registered and a no-op fixture exercises enqueue → consume. Coverage: smoke. Test: `packages/queue/tests/job-catalog-smoke.test.ts` (TBD V1).

### Tenant scoping
- **Given** any job whose payload references workspace data, **when** consumed, **then** the handler resolves the workspace context before any data access (no implicit cross-tenant leakage via job-payload mishandling). Coverage: integration. Test: `packages/queue/tests/job-handler-workspace-resolved.test.ts` (TBD V1).

### Operational
- **Given** the consumer process is killed mid-job, **when** restarted, **then** the job is retried (visibility timeout / pg-boss state machine). Coverage: integration. Test: `packages/queue/tests/restart-mid-job-retries.test.ts` (TBD V1).
- **Given** any consumer, **when** a job spans more than the configured warning latency, **then** a metric is emitted (`clearbolt_queue_job_duration_seconds`). Coverage: smoke. Test: `packages/queue/tests/duration-metric.test.ts` (TBD V1).
