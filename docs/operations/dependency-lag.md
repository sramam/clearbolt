# Dependency release lag (~30 days / ~4 weeks)

Clearbolt treats **~30 calendar days** as the minimum time a package version should have been on the public npm registry before we rely on it. This is roughly **four weeks** of calendar time (not ISO weeks); the encoded value is **30 days** so the policy is unambiguous in automation.

Rationale: reduce exposure to freshly published malicious or broken releases; align human review cadence with Renovate and local installs.

## Where it is encoded

| Mechanism | Role |
|-----------|------|
| [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) `minimumReleaseAge` + `minimumReleaseAgeStrict` | pnpm refuses **newly resolved** versions younger than the threshold. Value in **minutes** must match [`scripts/dependency-lag.config.json`](../../scripts/dependency-lag.config.json). |
| [`scripts/verify-dependency-lag.mjs`](../../scripts/verify-dependency-lag.mjs) | CI checks **every tarball** in `pnpm-lock.yaml` against registry publish timestamps. pnpm does not re-apply `minimumReleaseAge` to versions already pinned in the lockfile ([pnpm#10438](https://github.com/pnpm/pnpm/issues/10438)), so this script closes the gap. |
| [`renovate.json`](../../renovate.json) `minimumReleaseAge` + `internalChecksFilter` | Renovate waits before proposing npm updates (independent of pnpm; see [Renovate: Minimum Release Age](https://docs.renovatebot.com/key-concepts/minimum-release-age/)). |
| Root [`package.json`](../../package.json) `pnpm.overrides` | **Exception path only.** If the graph would otherwise pull ultra-fresh transitive packages (common with platform-specific optional deps), overrides may pin older versions that still satisfy semver/tooling. Prefer deleting overrides once a natural resolution is old enough. |
| [`scripts/dependency-lag.config.json`](../../scripts/dependency-lag.config.json) `securityAgeExceptions` | **Security-only bypass for the verifier.** Lets a specific `name@version` in the lockfile be newer than the lag window until `expires` (see [Security updates](#security-updates)). |

## Changing the lag window

1. Edit `minimumReleaseAgeMinutes` in `scripts/dependency-lag.config.json` (minutes).
2. Set `minimumReleaseAge` in `pnpm-workspace.yaml` to the **same** minute value.
3. Set Renovate `minimumReleaseAge` to the same human duration (e.g. `"28 days"` or `"30 days"`).
4. Run `pnpm install` and `pnpm run verify:dependency-lag`; adjust `pnpm.overrides` only if the verifier (or pnpm) cannot find a satisfying graph.

Emergency bypass for a one-off install (not for routine CI): `pnpm config set minimum-release-age 0` in the shell, or use pnpm’s documented override flags—then restore project config before committing.

## Security updates

Three layers:

1. **Renovate** — Vulnerability / security-driven updates **ignore** `minimumReleaseAge` by default, so Dependabot-style security PRs can land without waiting 30 days. See [Renovate: Minimum release age](https://docs.renovatebot.com/key-concepts/minimum-release-age/) (“Security updates bypass…”).

2. **pnpm** — For a local emergency install when resolution still blocks, you can temporarily add a package name to [`minimumReleaseAgeExclude`](https://pnpm.io/settings#minimumreleaseageexclude) in `pnpm-workspace.yaml`, merge the fix, then remove the exclude in a follow-up. Prefer the verifier exceptions below so the exception is explicit and dated.

3. **Lockfile verifier** — [`scripts/verify-dependency-lag.mjs`](../../scripts/verify-dependency-lag.mjs) has no access to GitHub’s “security” label. Add a row to **`securityAgeExceptions`** in [`scripts/dependency-lag.config.json`](../../scripts/dependency-lag.config.json) so CI accepts a **specific** `name` + `version` that is newer than the lag window. Each entry must include **`reason`** (e.g. advisory id or CVE). Use optional **`expires`** as an ISO calendar date (`YYYY-MM-DD`); after end of that UTC day the bypass no longer applies, forcing you to remove the row or wait until the release is old enough.

Example:

```json
"securityAgeExceptions": [
  {
    "name": "axios",
    "version": "1.8.2",
    "reason": "GHSA-xxxx — patch CVE-…",
    "expires": "2026-08-01"
  }
]
```

## Validation criteria

### Policy wiring

- **Given** the repository root, **when** a contributor opens `pnpm-workspace.yaml` and `scripts/dependency-lag.config.json`, **then** the `minimumReleaseAge` / `minimumReleaseAgeMinutes` values describe the same cooldown window (same minute count). Coverage: smoke. Test: manual review checklist in PR template / this doc.

### Automation

- **Given** CI on a PR, **when** the install job finishes, **then** `pnpm run verify:dependency-lag` exits 0 against the committed `pnpm-lock.yaml`. Coverage: smoke. Test: `.github/workflows/ci.yml`.

### Renovate

- **Given** Renovate is enabled for this repo, **when** it evaluates an npm dependency update, **then** `minimumReleaseAge` defers the PR until the release is older than the configured window (with `internalChecksFilter: "strict"`). Coverage: smoke. Test: Renovate dashboard / log (manual).

### Security bypass (verifier)

- **Given** a lockfile entry newer than the lag window, **when** `securityAgeExceptions` includes that exact `name` and `version` with `reason`, and `expires` is unset or not yet passed, **then** `pnpm run verify:dependency-lag` exits 0. **When** `expires` is in the past, **then** that entry no longer bypasses age checks. Coverage: smoke. Test: manual edit + CI.
