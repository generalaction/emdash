# Plan 007: Show per-task cost in the task titlebar (byCwd rollup + badge)

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving on. Touch only the files
> listed as in scope. If any STOP condition occurs, stop immediately and report.
> Do not improvise around obstacles. Commit your work following the git workflow
> section. SKIP updating `plans/README.md` — the reviewer maintains the index.
>
> **Drift check (run first)**:
> `git diff --stat cda29b2ed..HEAD -- src/shared/usage.ts src/main/core/usage-stats/aggregate.ts src/renderer/features/tasks/task-titlebar.tsx`
> Any change since `cda29b2ed` → compare "Current state" excerpts before proceeding.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (additive snapshot field; one new presentational component)
- **Depends on**: plans 001 (TTL, landed `d61e5320a`) and 004 (snapshot fields, landed `a667dce94`) — both already in HEAD
- **Category**: feature (from direction spike 006)
- **Planned at**: commit `cda29b2ed`, 2026-06-12

## Why this matters

Emdash provisions each task into its own git worktree and stores that path; every usage
record already carries the agent's working directory. Joining the two shows the user what
each task cost ("$0.42" on the task titlebar) — something no standalone usage tool can do,
because only emdash owns the task↔worktree mapping. The spike at
`docs/superpowers/specs/2026-06-11-per-task-usage-cost.md` chose Option A (a `byCwd`
rollup inside the existing snapshot — no new RPC) and its GO condition has been verified
empirically: stored `workspaces.path` values match transcript `cwd` strings byte-for-byte
on live data (5,835 + 1,302 matching lines across two real tasks; no symlink or
trailing-slash drift).

**Decided (do not revisit in this plan):** no agent-completion refresh hook in v1 — the
snapshot's 5-minute stale-while-revalidate TTL (plan 001) plus the renderer's 60s
`staleTime` bounds the badge's lag; acceptable. SSH tasks need no special-casing — a
remote path never matches a `byCwd` row, so the guard "no row → no badge" covers them.

## Current state

- `src/shared/usage.ts` — snapshot types. `UsageSnapshot` currently ends with
  `recentSessions: RecentSession[];` and `EMPTY_USAGE_SNAPSHOT.totals` is
  `{ sessions: 0, messages: 0, tokens: 0, cost: 0, unpricedTokens: 0 }`.
- `src/main/core/usage-stats/aggregate.ts` — the per-record loop. Today (post plan 004)
  the cost block reads:

```ts
    const cost = r.model ? costOf(buckets, r.vendor, r.model) : 0;
    const tokens = r.input + r.output;
    const priced = r.model ? isPriced(r.vendor, r.model) : false;
    if (r.model && !priced) totals.unpricedTokens += tokens;
```

  and the by-project block (the shape to mirror for byCwd):

```ts
    // by project (worktrees collapsed to their parent repo)
    if (r.cwd) {
      const pk = projectName(r.cwd);
      const pu = projects.get(pk) ?? { path: pk, name: pk, tokens: 0, cost: 0, sessions: 0 };
      pu.tokens += tokens;
      pu.cost += cost;
      projects.set(pk, pu);
    }
```

  Records are globally deduped by id BEFORE this loop (`byId` map at the top of
  `aggregate`), so any new rollup inherits dedup correctness automatically.
- `src/renderer/features/tasks/task-titlebar.tsx` — `ActiveTaskTitlebar` (an `observer`
  component) has `const workspace = useWorkspace();` in scope (`workspace.path` is the
  absolute worktree path) and a `rightSlot` that begins:

```tsx
      rightSlot={
        <div className="flex items-center gap-2">
          <DevServerPills projectId={projectId} taskId={taskId} />
          {!isRemoteProject && (
            <OpenInMenu path={workspace.path} className="h-7 bg-transparent" borderless />
          )}
```

- `src/renderer/features/usage/use-usage-snapshot.ts` — `useUsageSnapshot()` returns
  `{ snapshot, ... }`; calling it mounts the react-query fetch (which triggers the lazy
  main-process compute on first use — off the main thread via the worker; this is fine
  and intended).
- `src/renderer/features/usage/format.ts` — `fmtUsdPrecise(n)` renders `$0.42`-style.
- Existing badge exemplar in the same file: `LinkedIssueBadge` (a `Tooltip` +
  bordered `text-xs text-foreground-muted` chip). Match its look.
- `src/main/core/usage-stats/aggregate.test.ts` — `rec(over)` factory; default record has
  `cwd: '/Users/x/dev/garlic'`.
- Repo conventions: components in `src/renderer/features/tasks/components/` are
  PascalCase-exported from kebab-case files (see `components/dev-server-pills.tsx`).
  `CACHE_VERSION` must NOT change (persisted `UsageRecord` shape is untouched).

## Commands you will need

| Purpose   | Command                                                  | Expected on success |
|-----------|----------------------------------------------------------|---------------------|
| Install   | `pnpm install`                                            | exit 0              |
| Typecheck | `pnpm run typecheck`                                      | exit 0              |
| Tests     | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass (54 at baseline; more after) |
| Lint      | `pnpm run lint`                                           | exit 0              |
| Format    | `pnpm run format`                                         | exit 0              |

## Scope

**In scope** (the only files you may modify/create):
- `src/shared/usage.ts`
- `src/main/core/usage-stats/aggregate.ts`
- `src/main/core/usage-stats/aggregate.test.ts`
- `src/renderer/features/tasks/components/task-cost-badge.tsx` (create)
- `src/renderer/features/tasks/task-titlebar.tsx`

**Out of scope** (do NOT touch):
- `projectName()` / the existing `byProject` rollup — byCwd is a sibling, not a replacement.
- Task LIST rows, agent-completion refresh hooks, recent-session renaming — explicitly
  deferred follow-ups per the spike.
- `cache.ts` / `CACHE_VERSION`, `usage-stats-service.ts`, `pipeline.ts`, anything in
  `src/main/core/usage-stats/` besides `aggregate.ts(+test)`.
- `use-usage-snapshot.ts` — consume it as is.

## Git workflow

- Work on the current branch in your worktree.
- One commit: `feat(usage-stats): per-task cost badge in the task titlebar`
- Do NOT push.

## Steps

### Step 1: Shared type

In `src/shared/usage.ts` add:

```ts
/** Cost rolled up by literal working directory — joined against task worktree paths. */
export type CwdUsage = { cwd: string; tokens: number; cost: number };
```

Add `byCwd: CwdUsage[];` to `UsageSnapshot` (after `byProject`) and `byCwd: []` to
`EMPTY_USAGE_SNAPSHOT`.

**Verify**: `pnpm run typecheck` → fails ONLY in `aggregate.ts` (missing `byCwd` in the
return). Any other location is a STOP condition.

### Step 2: Aggregate rollup

In `aggregate.ts`:
- Add `CwdUsage` to the `@shared/usage` type import.
- Declare `const byCwd = new Map<string, CwdUsage>();` next to the `projects` map.
- Inside the existing `if (r.cwd)` block (after the `projects.set(pk, pu)` line), add:

```ts
      // by literal cwd (no project collapse) — the renderer joins this against task worktree paths
      const cu = byCwd.get(r.cwd) ?? { cwd: r.cwd, tokens: 0, cost: 0 };
      cu.tokens += tokens;
      cu.cost += cost;
      byCwd.set(r.cwd, cu);
```

- Add `byCwd: [...byCwd.values()],` to the returned snapshot (after `byProject`).

**Verify**: `pnpm run typecheck` → exit 0.

### Step 3: Aggregate tests

In `aggregate.test.ts` add one test using the `rec` factory:

```ts
  it('rolls up cost by literal cwd without project collapse, post-dedup', () => {
    const a = rec({ id: 'a', input: 1_000_000, cwd: '/Users/x/emdash/worktrees/proj/task-1' });
    const snap = aggregate(
      [
        a,
        { ...a }, // duplicate id — must not double-count in byCwd
        rec({ id: 'b', input: 500_000, cwd: '/Users/x/emdash/worktrees/proj/task-2' }),
      ],
      new Date('2026-05-30T18:00:00Z')
    );
    const t1 = snap.byCwd.find((c) => c.cwd === '/Users/x/emdash/worktrees/proj/task-1');
    const t2 = snap.byCwd.find((c) => c.cwd === '/Users/x/emdash/worktrees/proj/task-2');
    expect(t1?.tokens).toBe(1_000_000); // deduped
    expect(t1?.cost).toBeCloseTo(5, 6); // opus input $5/1M
    expect(t2?.tokens).toBe(500_000);
    expect(snap.byCwd).toHaveLength(2); // two distinct cwds, NOT collapsed to one project
  });
```

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/` → all pass.

### Step 4: Badge component

Create `src/renderer/features/tasks/components/task-cost-badge.tsx`:

```tsx
import { useUsageSnapshot } from '@renderer/features/usage/use-usage-snapshot';
import { fmtTokens, fmtUsdPrecise } from '@renderer/features/usage/format';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';

/**
 * Estimated AI cost for the work done in this task's worktree. Renders nothing when no
 * usage matches the path (unprovisioned, SSH/remote, or simply no agent activity yet) —
 * an absent badge is clearer than a "$0.00" that reads as "free".
 */
export function TaskCostBadge({ workspacePath }: { workspacePath: string }) {
  const { snapshot } = useUsageSnapshot();
  if (!workspacePath) return null;
  const row = snapshot.byCwd.find((c) => c.cwd === workspacePath);
  if (!row || row.cost <= 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex items-center rounded-md border border-border px-1.5 py-0.5 text-xs text-foreground-muted tabular-nums">
            {fmtUsdPrecise(row.cost)}
          </span>
        }
      />
      <TooltipContent>
        Estimated AI cost in this task&apos;s worktree · {fmtTokens(row.tokens)} tokens
      </TooltipContent>
    </Tooltip>
  );
}
```

Notes: no `useEffect`, no MobX — react-query supplies reactivity. Use the `render` prop
form of `TooltipTrigger` exactly as `LinkedIssueBadge` in `task-titlebar.tsx` does (this
repo's tooltip primitive uses `render`, not `asChild`). If `row.cost > 0` but rounds below
a cent, `fmtUsdPrecise` shows `$0.00` — acceptable; do not add extra formatting logic.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 5: Mount it in the titlebar

In `task-titlebar.tsx`, import `TaskCostBadge` from `./components/task-cost-badge` and add
it as the FIRST child of the `rightSlot` div in `ActiveTaskTitlebar` (before
`<DevServerPills …/>`):

```tsx
          <TaskCostBadge workspacePath={workspace.path} />
```

No other titlebar changes.

**Verify**: `pnpm run typecheck` → exit 0.

### Step 6: Full gate

**Verify**: `pnpm vitest run --project node src/main/core/usage-stats/` → all pass;
`pnpm run lint` → exit 0; `pnpm run format` → exit 0; re-run `pnpm run typecheck` → exit 0.

## Test plan

- The Step 3 aggregate test (dedup carry-through + no project collapse — the two
  correctness properties the spike called out).
- No component test: `TaskCostBadge` is presentational with a single `.find()`; the repo
  has no test harness precedent for titlebar components, and typecheck covers the wiring.

## Done criteria

ALL must hold:

- [ ] `pnpm run typecheck` exits 0
- [ ] `pnpm vitest run --project node src/main/core/usage-stats/` exits 0, including the new byCwd test
- [ ] `grep -n "byCwd" src/shared/usage.ts src/main/core/usage-stats/aggregate.ts src/renderer/features/tasks/components/task-cost-badge.tsx` matches in all three
- [ ] `grep -n "TaskCostBadge" src/renderer/features/tasks/task-titlebar.tsx` returns a match
- [ ] `grep -rn "useEffect" src/renderer/features/tasks/components/task-cost-badge.tsx` returns no matches
- [ ] `git status` shows no modified files outside the in-scope list

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's typecheck failures include files other than `aggregate.ts`.
- The `rightSlot` in the live titlebar doesn't match the "Current state" excerpt.
- The `TooltipTrigger` `render`-prop pattern doesn't typecheck as written AND the
  `LinkedIssueBadge` exemplar in the same file uses a different pattern than described.
- You're tempted to add a refresh hook, MobX store, or new RPC — all explicitly out of scope.

## Maintenance notes

- `byCwd` is unbounded over a user's lifetime (one row per distinct cwd ever seen,
  realistically a few hundred; ~4 KB IPC). If it ever needs bounding, bound at aggregate
  time, not in the renderer.
- Follow-ups deferred by design: task-list-row cost display, agent-completion
  `refresh()` trigger, resolving recent-session names via the task mapping.
- Reviewer should scrutinize: the badge renders nothing (not `$0.00`) when unmatched, and
  the byCwd accumulation sits INSIDE the existing `if (r.cwd)` block so null-cwd records
  can't create a `"null"` bucket.
