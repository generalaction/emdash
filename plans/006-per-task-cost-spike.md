# Plan 006: Spike — per-task cost attribution via the worktree mapping (design, not build)

> **Executor instructions**: This is a DESIGN SPIKE. You investigate and write a design
> document; you do NOT modify production source code. The only files you create are the
> design doc and the status row update. If anything in the "STOP conditions" section
> occurs, stop and report — do not improvise.
>
> **Drift check (run first)**:
> `git diff --stat ecb2a2125..HEAD -- src/main/core/usage-stats/aggregate.ts src/main/core/usage-stats/types.ts`
> A drifted aggregate is fine to note in the doc, but re-read it before citing line numbers.

## Status

- **Priority**: P3 (direction)
- **Effort**: M (investigation + doc; the build it specifies is a separate, later plan)
- **Risk**: LOW (read-only spike)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `ecb2a2125`, 2026-06-11

## Why this matters

Emdash runs each task in its own git worktree and the usage engine already captures the
working directory of every usage record. The two facts are one join away from a feature
no standalone usage tool can offer: "this task cost $1.40" displayed on the task itself.
The grounding is already in the code: `UsageRecord.cwd` is populated by all three parsers,
and `projectName()` in `aggregate.ts:35-42` already understands the
`…/worktrees/<project>/<branch>` layout to collapse worktrees into projects. This spike
decides whether and how to build the per-task view; its deliverable is a design doc with
a go/no-go recommendation, not code.

## Current state (verified facts to build on)

- `src/main/core/usage-stats/types.ts:4-17` — `UsageRecord` carries
  `cwd: string | null` and `sessionId: string` per parsed event.
- `src/main/core/usage-stats/aggregate.ts:35-42` — worktree-aware bucketing:

```ts
function projectName(cwd: string | null): string {
  if (!cwd) return 'unknown';
  const segments = cwd.split(/[\\/]+/).filter(Boolean);
  for (let i = segments.length - 2; i >= 0; i--) {
    if (segments[i] === 'worktrees' || segments[i] === '.worktrees') return segments[i + 1];
  }
  return dirName(cwd);
}
```

  Note it deliberately *discards* the branch segment — the per-task feature needs the
  opposite: the full worktree path as the join key.
- The snapshot (`src/shared/usage.ts`) aggregates to top-8 projects; per-cwd data is
  currently thrown away after aggregation.
- Usage RPC surface: `src/main/core/usage-stats/controller.ts` (getSnapshot, refresh),
  registered as `usageStats` in `src/main/rpc.ts`.
- Task/worktree data lives in the main DB (Drizzle/SQLite, `src/main/db/`); tasks are
  provisioned with worktree paths (see `agents/workflows/worktrees.md` and
  `src/main/core/workspaces/`). Exact schema/table names are part of what this spike
  must pin down.

## Commands you will need

| Purpose      | Command                                   | Expected |
|--------------|-------------------------------------------|----------|
| Search       | `grep -rn "worktreePath" src/main --include='*.ts' | head -30` | locations of the task↔path mapping |
| Schema       | read `src/main/db/schema*` / `src/main/db/` directory | table + column names |
| Sanity tests | `pnpm vitest run --project node src/main/core/usage-stats/` | all pass (you changed nothing) |

## Scope

**In scope** (create only):
- `docs/superpowers/specs/2026-06-11-per-task-usage-cost.md` (the deliverable)
- `plans/README.md` (status row only)

**Out of scope** (do NOT touch):
- ALL production source files. This spike writes zero code. A scratch exploration is
  fine in a REPL, but nothing under `src/` may be modified.

## Steps

### Step 1: Pin down the task ↔ worktree-path mapping

Find where emdash stores each task's worktree path (DB column, store field, or both).
Record in the doc: table/column names, the renderer-side selector that exposes it
(`src/renderer/features/tasks/stores/task-selectors.ts` is the documented home for task
selectors), and whether remote/SSH tasks store a *remote* path (they will not match local
transcript `cwd` values — this is the key feasibility question).

### Step 2: Validate the join empirically

Pick 2–3 recent emdash tasks on this machine and check (read-only, e.g. with `grep`/`jq`
over `~/.claude/projects/*/*.jsonl` or `~/.codex/sessions/**`) that transcript `cwd`
values exactly match the stored worktree paths (watch for: trailing slashes, symlink
resolution (`/var` vs `/private/var` on macOS), case differences). Record the evidence.

### Step 3: Sketch the API surface

Evaluate at least these two options and recommend one:

- **A. Per-cwd rollup in the snapshot**: extend `aggregate()` to also emit
  `byCwd: Array<{ cwd: string; tokens: number; cost: number }>` (cardinality = number of
  distinct cwds — estimate it from the real cache index) and let the renderer join
  against the task's worktree path.
- **B. Query API**: a new RPC `usageStats.costForPaths(paths: string[])` that filters
  records on demand — requires keeping records accessible post-aggregation (today they're
  discarded; the 45 MB index makes re-reading them non-trivial).

Consider: snapshot size growth, staleness (snapshot TTL vs "task just finished" — pairs
with plan 001 and the direction note about event-driven refresh), and dedup interplay
(records are deduped globally before aggregation; per-cwd rollups must use the same
deduped set).

### Step 4: Sketch the UI placement

One paragraph + ASCII sketch: where the cost appears (task header? task list row? both?),
what it shows for tasks with zero matched usage, and which existing component pattern it
reuses (`StatCard` is the obvious candidate).

### Step 5: Write the doc and recommend

Write `docs/superpowers/specs/2026-06-11-per-task-usage-cost.md` (follow the structure of
the existing `docs/superpowers/specs/2026-05-31-usage-stats-design.md`): problem, evidence
from steps 1–2, options with trade-offs, recommendation, open questions, and a build-plan
outline (suitable for turning into a future numbered plan). End with an explicit
**GO / NO-GO / GO-WITH-CONDITIONS** line.

**Verify**: doc exists; `git status` shows only the doc and `plans/README.md` changed;
`pnpm vitest run --project node src/main/core/usage-stats/` still passes (proof of no
source drift).

## Done criteria

- [ ] `docs/superpowers/specs/2026-06-11-per-task-usage-cost.md` exists and contains: the
      task↔path mapping facts, empirical join evidence, ≥2 API options with a
      recommendation, UI sketch, open questions, GO/NO-GO line
- [ ] `git status` shows no modified files under `src/`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- Step 2 shows transcript `cwd` values systematically do NOT match stored worktree paths
  (e.g. all symlink-resolved differently) — the feature premise fails; write that up as a
  NO-GO doc and stop.
- You cannot find any persisted task→worktree-path mapping (the join key doesn't exist).

## Maintenance notes

- If GO: the build plan should land *after* plans 001–004, since it touches `aggregate.ts`
  and the snapshot shape that 004 also modifies.
- Remote/SSH task attribution is allowed to be explicitly out of scope for v1 — say so in
  the doc rather than designing around it.
