# Plan 001: Recompute the usage snapshot when it goes stale (stale-while-revalidate)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/main/core/usage-stats/usage-stats-service.ts src/main/core/usage-stats/staleness.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (but if plan 002 already landed, `computeInWorker` will look different — that does NOT affect this plan; only `getSnapshot` changes here)
- **Category**: bug
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

`UsageStatsService.getSnapshot()` computes the usage snapshot once and then serves that
cached object for the entire app run. The renderer polls it through react-query (60s
`staleTime`, refetch on remount), but every refetch hits the same frozen snapshot — so the
"Today" cost and the rest of the Usage tab silently stop updating after the first open,
unless the user clicks the manual refresh button. After this plan, a snapshot older than a
TTL triggers a background recompute, and the user sees fresh numbers on their next visit
to the tab without ever blocking the UI. The recompute is cheap: the mtime+size file cache
in `cache.ts` means only changed transcript files re-parse.

## Current state

- `src/main/core/usage-stats/usage-stats-service.ts` — singleton service; the only file
  that changes. Lines 25–36 today:

```ts
  async getSnapshot(): Promise<UsageSnapshot> {
    if (this.snapshot.generatedAt === '') return this.refresh();
    return this.snapshot;
  }

  refresh(): Promise<UsageSnapshot> {
    if (this.computing) return this.computing;
    this.computing = this.compute().finally(() => {
      this.computing = null;
    });
    return this.computing;
  }
```

- `snapshot.generatedAt` is an ISO string set in `aggregate.ts` (`now.toISOString()`);
  it is `''` only for the initial `EMPTY_USAGE_SNAPSHOT`.
- `refresh()` already deduplicates concurrent computes via `this.computing`, so firing it
  in the background is safe.
- The renderer (`src/renderer/features/usage/use-usage-snapshot.ts:15`) uses
  `useQuery({ queryKey: KEY, queryFn: fetchSnapshot, staleTime: 60_000 })`. Do not change it.
- Repo conventions: main-process logging via `log` from `@main/lib/logger` (already
  imported in this file); small pure helpers get their own file + colocated
  `*.test.ts` (exemplar: `src/main/core/usage-stats/models-dev-parse.ts` and its test).

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Typecheck | `pnpm run typecheck`                                      | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass (37 at baseline; more after this plan) |
| Lint      | `pnpm run lint`                                           | exit 0              |
| Format    | `pnpm run format`                                         | exit 0              |

## Scope

**In scope** (the only files you may modify/create):
- `src/main/core/usage-stats/usage-stats-service.ts`
- `src/main/core/usage-stats/staleness.ts` (create)
- `src/main/core/usage-stats/staleness.test.ts` (create)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- `src/renderer/features/usage/use-usage-snapshot.ts` — the react-query polling is fine as is.
- `src/main/core/usage-stats/pipeline.ts`, `cache.ts` — the incremental cache already
  makes recompute cheap; no changes needed.
- Any eager/startup computation — the lazy first compute is a deliberate design decision
  (see the comment at `usage-stats-service.ts:19-24`); do not reintroduce warm-on-start.

## Git workflow

- Work on the current branch (`stats-4ahru`); this amends the usage-stats PR.
- One commit, Conventional Commits style, e.g.:
  `fix(usage-stats): recompute snapshot in background when older than TTL`
- Do NOT push unless the operator instructed it.

## Steps

### Step 1: Add the pure staleness helper

Create `src/main/core/usage-stats/staleness.ts`:

```ts
/** True when a snapshot's generatedAt is older than ttlMs (or missing/unparseable). */
export function isSnapshotStale(generatedAt: string, nowMs: number, ttlMs: number): boolean {
  const t = new Date(generatedAt).getTime();
  if (Number.isNaN(t)) return true;
  return nowMs - t > ttlMs;
}
```

Create `src/main/core/usage-stats/staleness.test.ts` (model the structure on
`src/main/core/usage-stats/models-dev-parse.test.ts`) covering: fresh timestamp → false;
timestamp older than ttl → true; empty string → true; garbage string → true; exactly at
the boundary (`nowMs - t === ttlMs`) → false.

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/staleness.test.ts` → all pass.

### Step 2: Use it in getSnapshot (stale-while-revalidate)

In `usage-stats-service.ts`, add near `WORKER_TIMEOUT_MS`:

```ts
// Serve-stale-while-revalidate window. Old snapshots are served instantly; a background
// refresh runs so the renderer's next poll picks up fresh numbers. Cheap: the mtime+size
// cache means only changed transcript files re-parse.
const SNAPSHOT_TTL_MS = 5 * 60_000;
```

Replace the `getSnapshot` body with:

```ts
  async getSnapshot(): Promise<UsageSnapshot> {
    if (this.snapshot.generatedAt === '') return this.refresh();
    if (isSnapshotStale(this.snapshot.generatedAt, Date.now(), SNAPSHOT_TTL_MS)) {
      this.refresh().catch((error) => log.warn('usage-stats: background refresh failed', { error }));
    }
    return this.snapshot;
  }
```

Import `isSnapshotStale` from `./staleness`. Note the background call is intentionally
not awaited — the current (stale) snapshot is returned immediately.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 3: Full gate

**Verify**:
- `pnpm vitest run --project node src/main/core/usage-stats/` → all pass.
- `pnpm run lint` → exit 0.
- `pnpm run format` → exit 0 (run it; it rewrites in place — that's expected for a formatter).

## Test plan

- New file `staleness.test.ts` with the 5 cases from Step 1.
- No service-level test: `usage-stats-service.ts` imports `electron` and is not runnable
  in the `node` vitest project. The TTL decision logic is fully covered by the pure helper.

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0, including ≥5 new staleness tests
- [ ] `grep -n "isSnapshotStale" src/main/core/usage-stats/usage-stats-service.ts` returns a match
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `getSnapshot`/`refresh` in the live file don't match the "Current state" excerpt
  (another plan or commit changed them — reconcile with the operator first).
- You find yourself wanting to change the renderer hook or add a file watcher — that is
  a different, larger design (see plans/README.md "Direction notes") and not this plan.
- Typecheck or tests fail twice after a reasonable fix attempt.

## Maintenance notes

- If event-driven invalidation lands later (refresh when an agent task turn ends — emdash
  owns the PTY so it knows), this TTL becomes a fallback, not the primary mechanism; keep it.
- Reviewer should scrutinize: that the background `refresh()` is not awaited, and that the
  error is logged (an unhandled rejection in main would crash noisy).
