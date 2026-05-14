# Transcript pipeline

Captured in [`packages/transcribe/agents.md`](../../packages/transcribe/agents.md). ADR: [../decisions/0009-transcript-tiered-pipeline.md](../decisions/0009-transcript-tiered-pipeline.md).

## Why tiered

Same shape as the scraper's HTTP -> browser fallback: try cheap-first, escalate when the cheap path fails or yields poor quality.

## Tiers (in order)

1. **YouTube Transcript API** (and YouTube Data API for metadata) — free for available transcripts. Fastest. Preferred when the URL is YouTube and a transcript exists. Runs anywhere.
2. **Whisper local on Fly.io** (ffmpeg downloads/extracts audio -> faster-whisper or whisper.cpp) — works for any source. Free per call (compute only). Default for non-YouTube and YouTube-with-no-transcript. **Fly-only** because ffmpeg + native binaries do not run on CF Workers.
3. **Gemini API** (audio in, transcript out) — paid fallback for difficult audio (heavy accents, noisy audio, multi-speaker) where local Whisper quality is insufficient. Runs anywhere.
4. **OpenAI Whisper API** — last-resort paid fallback if Gemini is rate-limited or unavailable. Runs anywhere.

## Pipeline

```
Input: { workspaceId, url | filePath, hint?: 'youtube' | 'podcast' | 'meeting' }

  1. classify URL/file
  2. if youtube -> try YouTubeTranscriptApi
  3. if no transcript or non-youtube -> ffmpeg fetch + extract audio (Fly)
  4. WhisperLocal on extracted audio
  5. quality gate: if confidence below threshold AND hint suggests difficult audio -> escalate
  6. GeminiAudio
  7. if rate-limited or fails -> OpenAIWhisperApi
  8. store raw audio in EvidenceStore
  9. store transcript markdown (with timestamps) in EvidenceStore
 10. index in MetadataStore
 11. enqueue wiki-ingest skill so the deal/conversation page picks up the transcript
```

## Output shape

```ts
{
  transcribeId: string;
  workspaceId: string;
  sourceUrl?: string;
  audioR2Key: string;
  transcriptR2Key: string;            // markdown with timestamped segments
  language: string;
  segments: Array<{ start: number; end: number; text: string; speaker?: string }>;
  tier: 'youtube' | 'whisper-local' | 'gemini' | 'openai';
  confidenceHint?: 'low' | 'medium' | 'high';
  costUsd: number;                    // 0 for youtube, ~0 for whisper-local (compute only), >0 for paid tiers
  durationSec: number;
}
```

## Cost controls

- Per-workspace monthly cap on paid tiers (Gemini + OpenAI). See [../operations/cost-budgets.md](../operations/cost-budgets.md).
- Quality gate before escalating to paid tier; cheaper tier's output kept as a baseline.
- Cache by source URL: same URL transcribed twice returns the cached transcript unless the user explicitly requests re-transcribe.

## Where it runs

- **Tier 1 (YouTube API)**: anywhere — Workers or Node.
- **Tier 2 (Whisper local)**: **Fly.io only** (ffmpeg + native binary).
- **Tier 3-4 (hosted APIs)**: anywhere.

The `Transcriber` contract is implementation-pluggable per [contracts.md](contracts.md), so tiers swap without changing consumers.

## Phasing

- **V0**: not implemented.
- **V1**: full tiered pipeline; wiki maintainer integration.
- **V2+**: speaker diarization improvements, summarization layer, automatic chaptering for long-form audio.

## Validation criteria

### Functional
- **Given** a YouTube URL with an available transcript, **when** `transcribe(url)` is called, **then** Tier 1 returns the transcript without invoking Tier 2-4 and `costUsd: 0`. Coverage: integration. Test: `packages/transcribe/tests/youtube-tier-1.test.ts` (TBD V1).
- **Given** a non-YouTube audio URL, **when** `transcribe(url)` is called, **then** Tier 2 (Whisper local on Fly) is the first attempt and the audio is cached in `EvidenceStore` for re-use. Coverage: integration. Test: `packages/transcribe/tests/whisper-local-tier-2.test.ts` (TBD V1).
- **Given** a transcript whose Tier 2 confidence is below threshold AND the hint suggests difficult audio, **when** the quality gate runs, **then** the request escalates to Tier 3 (Gemini). Coverage: integration. Test: `packages/transcribe/tests/quality-gate-escalation.test.ts` (TBD V1).
- **Given** a successful transcript, **when** the result is returned, **then** raw audio sits in `EvidenceStore` AND transcript markdown sits in `EvidenceStore` AND a `Transcript` row sits in `MetadataStore`. Coverage: integration. Test: `packages/transcribe/tests/storage-shape.test.ts` (TBD V1).
- **Given** a transcript already cached, **when** `transcribe(sameUrl)` is called, **then** the cached result is returned without re-fetching audio or re-running any tier. Coverage: integration. Test: `packages/transcribe/tests/cache-hit.test.ts` (TBD V1).

### Non-functional
- **Given** a per-workspace monthly cap on paid tiers, **when** the cap is exceeded mid-month, **then** further Tier 3-4 requests fail with `TranscriptionBudgetExceededError` and the workspace is notified. Coverage: integration. Test: `packages/transcribe/tests/budget-cap.test.ts` (TBD V1).
- **Given** a typical 30-minute conversation audio, **when** transcribed via Tier 2, **then** the cost is < $0.01 and latency p95 < 2 minutes. Coverage: smoke. Test: `packages/transcribe/tests/whisper-local-cost-latency.test.ts` (TBD V1).

### Failure modes
- **Given** Tier 2 is unhealthy (Fly machine unavailable), **when** the pipeline runs, **then** it falls back to Tier 3 (Gemini) without manual intervention. Coverage: integration. Test: `packages/transcribe/tests/tier-2-unhealthy-falls-to-3.test.ts` (TBD V1).
- **Given** Tier 4 (OpenAI Whisper API) is rate-limited, **when** Tier 3 is the next available tier with budget, **then** the pipeline does not get stuck retrying. Coverage: integration. Test: `packages/transcribe/tests/rate-limit-handling.test.ts` (TBD V1).

### Boundary
- **Given** a Workers runtime, **when** `transcribe()` is invoked, **then** Tier 2 is **not** attempted (ffmpeg + native binaries unavailable); the pipeline falls through to Tier 1 (if YouTube) or Tier 3-4. Coverage: integration. Test: `packages/transcribe/tests/workers-skips-tier-2.test.ts` (TBD V1).
