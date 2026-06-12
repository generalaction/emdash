# Plan 003: Skip rewriting the usage index when nothing changed, and remove the spread-push crash risk

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/main/core/usage-stats/cache.ts src/main/core/usage-stats/cache.test.ts src/main/core/usage-stats/pipeline.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf + bug
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

Measured on a real machine (1.75 GB of transcripts), the on-disk cache
`usage-index.json` is **45 MB**. Every refresh unconditionally re-serializes and rewrites
all 45 MB (`saveIndex` in `pipeline.ts`), even when no transcript file changed — pure
churn in the steady state where most refreshes find nothing new. Separately,
`records.push(...cached.records)` spreads a per-file record array into arguments; V8 caps
argument counts around 65k–125k, and the largest observed transcript already yields ~30k
records from one file — a 2–3× larger session file makes the whole pipeline throw
`RangeError` and usage stats hard-fail. Both fixes are local to `cache.ts`/`pipeline.ts`.

## Current state

- `src/main/core/usage-stats/cache.ts` — mtime+size reconcile cache. The loop (lines 25–42):

```ts
  const usable = prev.version === CACHE_VERSION ? prev.files : {};
  const nextFiles: Record<string, CachedFile> = {};
  const records: UsageRecord[] = [];

  for (const file of scan) {
    const cached = usable[file.path];
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
      nextFiles[file.path] = cached;
      records.push(...cached.records);
      continue;
    }
    let parsed: UsageRecord[];
    try {
      parsed = parse(readText(file), file);
    } catch {
      // Unreadable/partial file (e.g. caught mid-write): skip it entirely rather than caching
      // an empty-record entry, which would match next run's mtime+size and never re-parse.
      continue;
    }
    nextFiles[file.path] = { mtimeMs: file.mtimeMs, size: file.size, records: parsed };
    records.push(...parsed);
  }

  return { index: { version: CACHE_VERSION, files: nextFiles }, records };
```

- `src/main/core/usage-stats/pipeline.ts` — calls it (lines 35–41):

```ts
export function runPipeline(indexPath: string, now: Date): UsageSnapshot {
  const prev = loadIndex(indexPath);
  const scan = scanAll();
  const { index, records } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
  saveIndex(indexPath, index);
  return aggregate(records, now);
}
```

- `src/main/core/usage-stats/cache.test.ts` — existing tests use small local factories
  (`file(path, mtimeMs, size)`, `recordsFor(path)`) and `vi.fn()` parsers. Extend this
  file; match its style.
- `CACHE_VERSION` does NOT need bumping: the persisted `UsageRecord`/index shape is
  unchanged by this plan.

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`                                      | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass            |
| Lint      | `pnpm run lint`                                           | exit 0              |
| Format    | `pnpm run format`                                         | exit 0              |

## Scope

**In scope** (the only files you may modify):
- `src/main/core/usage-stats/cache.ts`
- `src/main/core/usage-stats/cache.test.ts`
- `src/main/core/usage-stats/pipeline.ts`
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `saveIndex`/`loadIndex` internals (atomic-write tempfile schemes, compression,
  streaming JSON) — `loadIndex` already self-heals from corruption; don't gold-plate.
- `usage-stats-service.ts`, `usage-worker.ts` — plans 001/002 own those files.
- Changing the cache to store aggregates instead of records — cross-file dedup
  (`aggregate.ts` dedups by record id) requires the raw records.

## Git workflow

- Work on the current branch (`stats-4ahru`).
- One commit, e.g.: `perf(usage-stats): skip index rewrite when unchanged; avoid spread-push RangeError`
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Replace the two spread-pushes with loops

In `cache.ts`, replace `records.push(...cached.records);` with:

```ts
      for (const r of cached.records) records.push(r);
```

and `records.push(...parsed);` with the equivalent loop. Add one comment at the first
site: `// no spread: a single huge file's records would exceed V8's argument limit`.

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/cache.test.ts` → all pass (existing behavior unchanged).

### Step 2: Report whether the index changed

Change `reconcileCache`'s return type to
`{ index: UsageIndex; records: UsageRecord[]; changed: boolean }`.

Compute `changed` as:

```ts
  let parsedAny = false;            // set true right after a successful parse(...)
  // ... loop ...
  const changed =
    prev.version !== CACHE_VERSION ||
    parsedAny ||
    Object.keys(nextFiles).length !== Object.keys(usable).length;
```

Reasoning to preserve in a short comment: a re-parse or a version reset always dirties
the index; a deleted file changes the key count; an added file implies a parse. The one
intentional asymmetry: a file whose parse *throws* and that was never cached leaves the
index unchanged (`parsedAny` stays false for it only if no other file parsed) — that's
correct, there is nothing new to persist.

Note: a thrown parse sets nothing — make sure `parsedAny = true` is assigned only after
`parse(...)` returns, not before.

**Verify**: `pnpm run typecheck` → FAILS with exactly one consumer error in
`pipeline.ts` (destructuring) — expected; fixed next step.

### Step 3: Skip the save when unchanged

In `pipeline.ts`:

```ts
  const { index, records, changed } = reconcileCache(prev, scan, readScannedText, parseScannedFile);
  if (changed) saveIndex(indexPath, index);
```

**Verify**: `pnpm run typecheck` → exit 0.

### Step 4: Tests

Extend `cache.test.ts` (same factories/style) with:

1. `changed` is `true` on first run with a new file.
2. `changed` is `false` when re-reconciling the same scan against the produced index
   (the steady-state no-op case — this is the regression test for the 45 MB rewrite).
3. `changed` is `true` when a file is deleted (scan no longer contains it).
4. `changed` is `true` on version mismatch even when mtime+size match (extend the
   existing "discards the whole index on version mismatch" test).
5. A file whose parse throws, with an otherwise-identical scan and a prev index that
   never contained it → `changed` is `false`.
6. (Spread guard) a single cached file with 200_000 records reconciles without throwing
   and yields 200_000 records. Build the array with a loop; this runs in well under a second.

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/` → all pass.

### Step 5: Full gate

**Verify**: `pnpm run lint` → exit 0; `pnpm run format` → exit 0.

## Test plan

Covered by Step 4 (six cases, in `cache.test.ts`, modeled on the existing tests in that file).

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0, including the 6 new cases
- [ ] `grep -n "push(\.\.\." src/main/core/usage-stats/cache.ts` returns no matches
- [ ] `grep -n "if (changed) saveIndex" src/main/core/usage-stats/pipeline.ts` returns a match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- The `reconcileCache` loop in the live file doesn't match the "Current state" excerpt.
- You find another consumer of `reconcileCache` besides `pipeline.ts` and `cache.test.ts`
  (`grep -rn "reconcileCache" src/` should show exactly those two files plus the definition).
- The 200k-record test is slow (>5s) or flaky — report rather than deleting it.

## Maintenance notes

- If the index ever grows a new top-level field, the `changed` computation must account
  for it (key-count comparison only covers `files`).
- Reviewer should scrutinize: the `parsedAny` placement (after successful parse only) and
  that case 2 (steady-state no-op) actually asserts `changed === false`, not just "no throw".
- Deferred deliberately: atomic tempfile writes for `saveIndex` (self-healing load makes
  it low value) and streaming/compressed index formats (no evidence 45 MB load time hurts;
  it runs in the worker).
