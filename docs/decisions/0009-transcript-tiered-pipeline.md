# ADR 0009 — Transcript pipeline: tiered fallback (YouTube -> WhisperLocal -> Gemini -> OpenAI)

Status: accepted

## Context

Searchers consume audio/video research (YouTube interviews, podcast episodes, broker call recordings, conference talks, AI-summarized meetings). Putting that content into the per-deal wiki requires transcription. Quality, cost, and runtime constraints conflict:

- YouTube provides free transcripts when they exist; usually not aligned with conversational accuracy needs.
- Local Whisper is free per call (compute only) but requires ffmpeg + native binaries — only runs on Fly.io, not CF Workers.
- Hosted APIs (Gemini, OpenAI Whisper) cost $$ per minute but handle hard audio that local Whisper struggles with.

## Decision

Tiered fallback pipeline. Same shape as the scraper's HTTP-first + browser-fallback pattern.

Tiers (in order):

1. **YouTube Transcript API** — free; preferred for YouTube URLs with available transcripts.
2. **Whisper local on Fly.io** (ffmpeg + faster-whisper or whisper.cpp) — free per call (compute only); default for non-YouTube and YouTube-with-no-transcript.
3. **Gemini API** — paid; fallback for difficult audio (heavy accents, noisy, multi-speaker) where local Whisper quality is insufficient.
4. **OpenAI Whisper API** — last-resort paid fallback.

Quality gate between tiers: if the cheaper tier's confidence is acceptable, do not escalate. Per-workspace monthly cap on paid tiers.

`Transcriber` contract pluggable per [`packages/transcribe/agents.md`](../../packages/transcribe/agents.md).

## Consequences

- Most transcription is free (YouTube) or near-free (compute on Fly).
- Paid tiers gated by quality and budget; expensive surprises avoided.
- Transcribe worker is **Fly-only** for tier 2 (ffmpeg + native binary). Tiers 1, 3, 4 can run anywhere.
- Same `Transcriber` contract on every tier — pipeline orchestration is a thin wrapper.
- Raw audio cached in R2 indefinitely so re-transcription with a different tier is free of re-fetch cost.

## Falsifiability criteria

- **Trigger**: average cost per transcribed minute exceeds $0.05 over a rolling 30-day window.
  **Measurement**: cost dashboard joining `Transcript` records with their tier and minute count.
  **Response**: tune escalation thresholds (lower confidence required to stay on local Whisper); revisit Fly machine sizing to improve local Whisper quality.
- **Trigger**: workspace transcripts blocked by paid-tier monthly cap exceeds 5% of attempts.
  **Measurement**: telemetry on quality-gate skips and budget-cap denials.
  **Response**: revisit per-workspace caps; consider charging transcription as a metered add-on; revisit quality gate thresholds.
- **Trigger**: local Whisper on Fly fails to handle >25% of audio (escalates to a paid tier).
  **Measurement**: telemetry on tier escalation events.
  **Response**: investigate Fly machine sizing, Whisper model variant (medium vs large-v3), or audio preprocessing (noise suppression, diarization).
- **Trigger**: re-transcription of a cached audio file requires a re-fetch from the source URL (the R2 cache contract breaks).
  **Measurement**: trace analysis on `Transcriber` re-runs.
  **Response**: incident; the cache invariant is the basis for cheap A/B-ing tier choices.
- **Trigger**: CF ships a runtime extension for ffmpeg or local Whisper that is cost-competitive with Fly.
  **Measurement**: routine vendor-feature review (quarterly).
  **Response**: revisit transcribe placement; may consolidate to CF Workers.
