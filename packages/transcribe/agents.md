# `packages/transcribe`

> Runtime: **node** (Fly.io for ffmpeg + faster-whisper); **both** for hosted-API fallbacks.

Tiered transcript pipeline. Cross-cuts [`docs/architecture/transcripts.md`](../../docs/architecture/transcripts.md). ADR: [`docs/decisions/0009-transcript-tiered-pipeline.md`](../../docs/decisions/0009-transcript-tiered-pipeline.md).

## `Transcriber` contract

```ts
interface Transcriber {
  name: 'youtube' | 'whisper-local' | 'gemini' | 'openai';
  runtime: 'node' | 'workers' | 'both';
  estimateCost(input: TranscribeInput): Promise<{ usd: number }>;
  transcribe(input: TranscribeInput): Promise<TranscribeResult>;
}

interface TranscribeInput {
  workspaceId: string;
  url?: string;
  audioR2Key?: string;
  hint?: 'youtube' | 'podcast' | 'meeting' | 'interview';
}

interface TranscribeResult {
  transcribeId: string;
  workspaceId: string;
  sourceUrl?: string;
  audioR2Key: string;
  transcriptR2Key: string;            // markdown with timestamped segments
  language: string;
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  tier: 'youtube' | 'whisper-local' | 'gemini' | 'openai';
  confidenceHint?: 'low' | 'medium' | 'high';
  costUsd: number;
  durationSec: number;
}
```

## Backends

### `YouTubeTranscriptApi`

- `youtube-transcript` library + YouTube Data API for metadata.
- Free for available transcripts.
- Runtime: `both`.

### `WhisperLocal`

- ffmpeg downloads/extracts audio.
- `faster-whisper` (Python) or `whisper.cpp` (native) does inference.
- Free per call (compute only on Fly machine).
- Runtime: `node` only — Fly.io.

### `GeminiAudio`

- Gemini API; audio in, transcript out.
- Paid; good for difficult audio.
- Runtime: `both`.

### `OpenAIWhisperApi`

- Last-resort paid fallback.
- Runtime: `both`.

## Pipeline

```ts
async function transcribePipeline(input: TranscribeInput): Promise<TranscribeResult> {
  // Tier 1: youtube
  if (isYouTubeUrl(input.url)) {
    const r = await ytApi.transcribe(input);
    if (r.confidenceHint !== 'low') return store(r);
  }

  // Tier 2: whisper local on Fly
  const audio = await fetchAudio(input);                 // ffmpeg
  const r = await whisperLocal.transcribe({ ...input, audioR2Key: audio.key });
  if (passesQualityGate(r, input.hint)) return store(r);

  // Tier 3: gemini
  if (geminiAvailable()) {
    const r = await gemini.transcribe({ ...input, audioR2Key: audio.key });
    if (r) return store(r);
  }

  // Tier 4: openai
  const r4 = await openai.transcribe({ ...input, audioR2Key: audio.key });
  return store(r4);
}
```

Cost gate before escalating to paid tier; cheaper tier's output kept as a baseline.

## Caching

- Cache by source URL: same URL transcribed twice returns the cached transcript unless the user explicitly requests re-transcribe.
- Raw audio cached in R2 indefinitely (cheap; replays).

## Wiki integration

Once a transcript is stored, enqueue `wiki-ingest` ([`packages/wiki/agents.md`](../wiki/agents.md)) with `{ kind: 'transcript', id }`. The wiki maintainer routes the transcript to the right place — a deal page, a conversation page (`conversations/<captureId>.md`), or a concept page.

## Cost controls

- Per-workspace monthly cap on Gemini + OpenAI usage.
- Quality gate before escalating; if the cheaper tier's output is "good enough" for the workspace's quality preference, skip escalation.
- See [`docs/operations/cost-budgets.md`](../../docs/operations/cost-budgets.md).

## Phasing

- V0: not implemented.
- V1: full tiered pipeline (YouTube + WhisperLocal + Gemini + OpenAI), wiki maintainer integration.
- V2+: speaker diarization improvements, summarization layer, automatic chaptering for long-form audio.

## Validation criteria

### Contracts
- **Given** any `Transcriber` backend, **when** the conformance suite at `packages/transcribe/src/conformance/transcriber.suite.ts` runs, **then** all assertions pass: `transcribe` returns a `TranscribeResult` with non-empty `segments`, monotonically increasing `start`/`end` timestamps, populated `language`, and a `costUsd`. Coverage: integration. Test: `packages/transcribe/tests/conformance.test.ts` (TBD V1).
- **Given** any `Transcriber`, **when** `estimateCost(input)` is called, **then** the actual `costUsd` after `transcribe` is within ±20% of the estimate (or the test surfaces the estimator drift). Coverage: integration. Test: `packages/transcribe/tests/cost-estimate-accuracy.test.ts` (TBD V1).

### Tier escalation
- **Given** a YouTube URL with an available transcript, **when** the pipeline runs, **then** Tier 1 (YouTube) returns and Tiers 2-4 are not invoked. Coverage: integration. Test: `packages/transcribe/tests/youtube-tier-short-circuit.test.ts` (TBD V1).
- **Given** Tier 2 (whisper-local) output below the quality gate, **when** evaluated, **then** the pipeline escalates to Tier 3 (Gemini); if Gemini is unavailable, to Tier 4 (OpenAI). Coverage: integration. Test: `packages/transcribe/tests/tier-escalation.test.ts` (TBD V1).
- **Given** the workspace's monthly Gemini+OpenAI cap is reached, **when** Tier 3 or Tier 4 would be invoked, **then** the call is rejected and the lower-tier output is returned with a `confidenceHint=low` flag. Coverage: integration. Test: `packages/transcribe/tests/cost-cap-blocks-paid-tier.test.ts` (TBD V1).

### Caching
- **Given** the same `sourceUrl` transcribed twice, **when** the second call runs, **then** the cached transcript is returned and no audio is re-fetched. Coverage: integration. Test: `packages/transcribe/tests/cache-by-url.test.ts` (TBD V1).
- **Given** an explicit re-transcribe request, **when** invoked, **then** the cache is bypassed and a new transcript is produced and stored alongside the prior version. Coverage: integration. Test: `packages/transcribe/tests/explicit-retranscribe.test.ts` (TBD V1).

### Quality gate (hard rule)
- **Given** any tier's output, **when** the quality gate evaluates it, **then** outputs failing the gate are not stored as canonical and the pipeline either escalates or returns with a `confidenceHint=low` and a clear reason. Coverage: integration. Test: `packages/transcribe/tests/quality-gate-blocks-low.test.ts` (TBD V1). Cross-link to [`docs/operations/failure-modes.md`](../../docs/operations/failure-modes.md) "Whisper-local quality on hard audio".

### Wiki integration
- **Given** a stored transcript, **when** the pipeline completes, **then** a `wiki-ingest` job is enqueued with `{ kind: 'transcript', id }`. Coverage: integration. Test: `packages/transcribe/tests/wiki-ingest-enqueued.test.ts` (TBD V1).

### Storage
- **Given** any transcript, **when** stored, **then** both `audioR2Key` and `transcriptR2Key` are workspace-prefixed (`workspaces/<workspaceId>/transcripts/...`). Coverage: integration. Test: `packages/transcribe/tests/transcript-tenant-prefixed.test.ts` (TBD V1).

### Cross-link
- ADR: [`docs/decisions/0009-transcript-tiered-pipeline.md`](../../docs/decisions/0009-transcript-tiered-pipeline.md).
- Architecture: [`docs/architecture/transcripts.md`](../../docs/architecture/transcripts.md).
