# `packages/wiki-fs`

> Runtime: **node**. Disk-backed `WikiStore` for V0 / local dev.

Implements [`packages/storage`](../storage/agents.md)'s `WikiStore` contract against the local filesystem.

## Layout

```
<root>/workspaces/<workspaceId>/wiki/...
```

The directory tree under each workspace mirrors the layout in [`docs/architecture/wiki.md`](../../docs/architecture/wiki.md): `AGENTS.md`, `index.md`, `log.md`, `deals/<id>/...`, `entities/...`, `concepts/...`, `conversations/...`.

## Optional git versioning

If `WIKI_FS_GIT=true`, on first use of a workspace's wiki directory, `git init` runs. Every `write()` call commits with a maintainer-stamped message:

```
<maintainer-version>: ingest source <sourceRecordId> for deal <dealId>
```

Git is optional — useful in V0 dev for hand-inspecting maintainer behavior. V1+ uses `wiki-r2` snapshots for versioning instead.

## Conformance

Implements the full `WikiStore` conformance suite from `packages/storage`.

## When to use

- V0: always.
- V1+ dev: when you want a fast local wiki without R2 latency.
- V1+ prod: never. Use [`packages/wiki-r2`](../wiki-r2/agents.md).

## Validation criteria

### Conformance
- **Given** the `WikiFsStore` backend, **when** the `WikiStore` conformance suite from `packages/storage/src/conformance/wiki.suite.ts` runs, **then** all assertions pass: write/read exact match, list with prefix, optional snapshot. Coverage: integration. Test: `packages/wiki-fs/tests/conformance.test.ts`.

### Layout
- **Given** any workspace's wiki directory, **when** initialized, **then** the directory tree under `<root>/workspaces/<workspaceId>/wiki/` matches the schema in [`docs/architecture/wiki.md`](../../docs/architecture/wiki.md). Coverage: integration. Test: `packages/wiki-fs/tests/layout-matches-schema.test.ts` (TBD V0).

### Tenant isolation
- **Given** workspace A's `WikiFsStore`, **when** any read or write is attempted with workspace B's path, **then** the operation is rejected (path traversal prevention + workspace scoping). Coverage: integration. Test: `packages/wiki-fs/tests/no-cross-workspace-path.test.ts` (TBD V0).

### Optional git
- **Given** `WIKI_FS_GIT=true`, **when** a workspace's wiki is first written, **then** `git init` runs on its directory and the first write commits with the maintainer-stamped message. Coverage: integration. Test: `packages/wiki-fs/tests/git-init-and-commit.test.ts` (TBD V0).
- **Given** `WIKI_FS_GIT=false` (default in CI), **when** writes occur, **then** no `.git` directory is created. Coverage: integration. Test: `packages/wiki-fs/tests/git-disabled-by-default.test.ts` (TBD V0).
