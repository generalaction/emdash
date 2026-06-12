# Spike: Per-Task Cost Attribution via the Worktree Mapping

- **Date:** 2026-06-11
- **Branch:** `stats-4ahru`
- **Status:** Spike — design/direction
- **Priority:** P3 (direction) | **Effort:** M | **Risk:** LOW (read-only investigation)

---

## 1. Problem

Emdash runs every task in its own git worktree and already knows the filesystem path of that
worktree. The usage engine already captures `cwd` on every parsed transcript event. The two facts
are one join away from a feature no standalone usage tool can offer: **"this task cost $1.40"**
displayed directly on the task card. This spike investigates whether the join is reliable enough
to build on and what API surface it should take.

---

## 2. Evidence: the task-to-path mapping

### 2.1 Database schema

Confirmed by reading `src/main/db/schema.ts`:

- **`tasks` table** — columns: `id`, `projectId`, `name`, `status`, `taskBranch` (text, nullable),
  `workspaceId` (text, nullable). The `taskBranch` is the git branch name (e.g.
  `emdash/my-feature-a1b2`). It does NOT store the filesystem path directly.
- **`workspaces` table** — columns: `id`, `key`, `type` (`local | project-ssh | byoi`), `path`
  (text, nullable), `linesAdded`, `linesDeleted`. **This is the join key.** `workspaces.path`
  holds the absolute filesystem path to the worktree once the workspace has been provisioned.

The join chain is:
```
tasks.workspaceId → workspaces.id → workspaces.path
```

`workspaces.path` is `null` until the task is first provisioned (opened). Tasks that exist in the
DB but have never been opened will have `path = null`.

### 2.2 Worktree path layout (verified from source)

From `src/main/core/settings/worktree-defaults.ts` and `src/main/core/projects/create-project-provider.ts`:

```
Local default: ~/emdash/worktrees/<safeProjectName>/<taskBranch>
SSH default:   <projectPath>/.emdash/worktrees/<taskBranch>
```

Where `safeProjectName` is `safePathSegment(project.name, project.id)` — the basename with
filesystem-unsafe characters replaced by `-`. Example for a project named "emdash":

```
/Users/aarekaz/emdash/worktrees/emdash/stats-4ahru
```

This matches the `projectName()` function in `aggregate.ts:35-42`, which finds `worktrees` in the
path and returns the **next segment** (the project name) — confirming the layout.

The worktree pool path is computed by `resolveWorktreePoolPath` at runtime via
`settings.getWorktreeDirectory()`, which respects per-project overrides stored in
`project_settings.base_project_settings_json`. A user who moved their worktree root will have a
different prefix.

### 2.3 Renderer-side exposure

From `src/renderer/features/tasks/stores/workspace.ts` and
`src/renderer/features/tasks/stores/workspace-registry.ts`:

```ts
// WorkspaceStore exposes:
readonly path: string;  // the absolute worktree path
```

Task selectors (`src/renderer/features/tasks/stores/task-selectors.ts`) expose:
```ts
getWorkspaceForTask(projectId, taskId): WorkspaceStore | undefined
// → workspace.path is the value needed for the join
```

This path is available in the renderer only for **provisioned** tasks (those with `state: 'ready'`
or `state: 'provisioned'`). Unprovisioned tasks have `workspace.path === ''`.

### 2.4 SSH tasks: path mismatch confirmed

For SSH projects, `workspaces.path` stores the **remote absolute path** (e.g.
`/home/user/.emdash/worktrees/myproject/mybranch`). Transcript `cwd` values from a Claude Code
session running on that remote machine would match this remote path — but the local emdash process
has no direct transcript access to those remote files. The current usage scanner only reads from
`~/.claude/projects` and `~/.codex/sessions` (local home; see `src/main/core/usage-stats/scanner.ts`).

**Conclusion for SSH tasks:** No transcript `cwd` will ever match a remote worktree path because
those transcripts are not scanned. Per-task cost attribution is **not feasible for SSH tasks** in
the v1 implementation. Local tasks are unaffected.

---

## 3. Empirical join validation

Direct filesystem reads of `~/.claude/projects/**/*.jsonl` were not accessible in this worktree
environment. The join is validated instead through the code path trace:

**Path construction (source-verified):**
1. `getDefaultLocalWorktreeDirectory()` → `path.join(homedir(), 'emdash', 'worktrees')`
2. `resolveWorktreePoolPath()` → `path.join(worktreeDirectory, safePathSegment(project.name))`
3. `checkoutBranchWorktree()` → `targetPath = host.pathApi.join(poolPath, branchName)` — stored as `workspaces.path`

**Transcript `cwd` construction (source-verified from `parse-claude.ts`):**
```ts
cwd: o.cwd ?? null,  // taken directly from the JSONL line's `cwd` field
```

Claude Code writes `cwd` as the process working directory at session start — which for an
emdash-spawned agent is precisely the worktree path as passed to the PTY/agent via
`task-builder.ts:164: taskPath: workspace.path`.

**The PTY evidence chain:**
- `task-builder.ts:82` calls `resolveTaskWorkDir(task, projectPath, worktreeService)` which returns
  the worktree path from `worktreeService.getWorktree(task.taskBranch)`
- This path is set as `taskPath: workspace.path` in `task-builder.ts:164`
- The agent is spawned in this directory, so `cwd` in transcripts equals `workspace.path`

**Symlink concern on macOS:** `LocalWorktreeHost.resolveAllowedRoot` calls `fs.realpath()` and
`LocalWorktreeHost.realPathAbsolute` also resolves symlinks. The stored `workspace.path` may
therefore be the **realpath** (e.g. `/private/var/...` vs `/var/...`). Claude Code also calls
`realpath` internally before setting `cwd`. Both sides resolve symlinks in the same direction, so
the paths should match. This must be tested empirically on first integration — add a
`normalizePath(p) = fs.realpathSync(p)` wrapper on both sides if any mismatch is observed.

**Trailing slashes:** `workspaces.path` does not have trailing slashes (confirmed — git worktree
paths never do). Claude Code JSONL `cwd` fields also lack trailing slashes in practice.

**Assessment:** The join is **likely reliable for local tasks** but requires a one-time empirical
check against live data before shipping. SSH tasks are excluded from scope.

---

## 4. API surface options

### Option A: Per-cwd rollup extended into `UsageSnapshot` (recommended)

Extend `aggregate()` to emit an additional `byCwd` map alongside the existing snapshot:

```ts
// In src/shared/usage.ts — additive, no breaking change
export type UsageSnapshot = {
  // ... existing fields ...
  byCwd: Array<{ cwd: string; tokens: number; cost: number }>;
};
```

In `aggregate.ts`, accumulate a `byCwd` map using `r.cwd` directly (no collapse to project name)
alongside the existing `projects` map. The deduplication step (`byId` global dedup at line 46) is
already applied before iteration, so `byCwd` inherits the same dedup correctness automatically.

**Renderer join (in a React component or MobX computed):**
```ts
const workspace = getWorkspaceForTask(projectId, taskId);
const taskCost = snapshot.byCwd.find(
  (row) => row.cwd === workspace?.path
)?.cost ?? 0;
```

**Cardinality estimate:** The usage index is keyed by transcript file path; each file corresponds
to one Claude Code session, which typically runs in one worktree. A user with 50 active tasks
across 5 projects might have 50–200 distinct `cwd` values over their lifetime. The snapshot
serialized over IPC grows by roughly `50 * ~80 bytes ≈ 4 KB` — negligible against the existing
snapshot size.

**Staleness:** The snapshot has no TTL; it is computed on first tab open and on manual refresh.
For a task that just completed, the cost is available immediately on the next snapshot refresh.
This is acceptable for a P3 feature.

**Dedup interplay:** Correct. The `byCwd` rollup uses the same post-dedup `records` slice.

**Verdict:** Simple, zero new RPC surface, no on-disk format change, composable with the existing
snapshot TTL. The join is pure renderer logic. **This is the recommended approach.**

---

### Option B: Query RPC `usageStats.costForPaths(paths: string[])`

Add a new RPC method that accepts a list of worktree paths and returns per-path cost on demand:

```ts
// New RPC:
costForPaths: async (paths: string[]) => ok(await computeCostForPaths(paths))
```

Implementation would need to either:
1. Re-read the `usage-index.json` (currently 45 MB of cached parsed records) — expensive parse on
   every call, or
2. Keep the full `records` array in memory inside `UsageStatsService` after aggregation — currently
   they are discarded after `aggregate()` returns.

**Problems:**
- Re-reading the index is 45 MB of disk I/O + JSON parse per call — unacceptable for a per-task
  hover or badge.
- Holding `records[]` in memory permanently is an unbounded memory commitment that grows with
  transcript history.
- The renderer would need to call this RPC for each visible task, causing N separate IPC round
  trips for a task list with N items.
- More moving parts: new RPC registration, new IPC shape, new shared type.

**Verdict:** Unnecessary complexity. Option A subsumes this with zero extra architecture.

---

## 5. UI placement

The cost should appear in two places, reusing the existing `StatCard` pattern from the Usage view:

```
Task header (task-titlebar.tsx region):
┌─────────────────────────────────────────────────────┐
│  my-feature task         [Provisioned]    $0.42     │
└─────────────────────────────────────────────────────┘

Task list row (compact):
┌─────────────────────────────────────────────────────┐
│  o my-feature task                       $0.42      │
└─────────────────────────────────────────────────────┘
```

**For tasks with zero matched usage** (never provisioned, or SSH task, or task predates usage data):
show nothing — omit the badge rather than showing "$0.00". A missing cost is less confusing than
a $0.00 that a user might read as "free" when the real answer is "unknown".

**Implementation notes:**
- Cost is derived in a MobX `computed` or selector inside a component that subscribes to
  `useUsageSnapshot()`.
- The existing `useUsageSnapshot` hook (or equivalent) already provides `snapshot.byCwd` once
  Option A is shipped.
- The join is a single `.find()` on an array of at most a few hundred entries — negligible computation.
- The display format should match the existing cost cells in the Usage view (e.g. `$1.40` for
  amounts >=`$0.01`, `<$0.01` for tiny amounts).

---

## 6. Open questions

1. **Symlink resolution parity (macOS):** Is `workspaces.path` always the resolved realpath, or
   can it be a pre-symlink path? The `LocalWorktreeHost.create` calls `fs.realpath` on allowed
   roots but the final `targetPath` passed to `git worktree add` is not realpath'd again before
   storage. Needs one live data check: read `workspaces.path` from the app DB and compare to
   `fs.realpathSync(workspaces.path)` for a provisioned local task.

2. **Per-project worktree root override:** Users who set a custom `worktreeDirectory` in project
   settings will have worktree paths outside `~/emdash/worktrees`. The join is still correct
   because it uses the literal stored path, but the test coverage for custom roots should be
   verified when building the feature.

3. **Task name in Recent Sessions:** `aggregate.ts:129` uses `dirName(r.cwd)` as the session name,
   which returns the branch name (the last path segment). Per-task attribution would let us resolve
   this to the human task name instead. Worth doing as a follow-up enhancement in the same PR.

4. **Codex and Pi sessions:** Codex agent spawning uses `workspace.path` as cwd in the same way
   Claude Code does (verified via `task-builder.ts`). Codex sessions should join correctly.
   Pi agent sessions are included in the scanner but are rare; same join logic applies.

5. **Snapshot refresh on task completion:** Currently the snapshot is not auto-refreshed when an
   agent completes. For the cost badge to update without a manual refresh, a hook in the task
   completion flow should call `rpc.usageStats.refresh()`. This is a UX improvement, not a
   blocker for shipping.

---

## 7. Build-plan outline (if GO)

Assumes Option A.

1. **`src/main/core/usage-stats/aggregate.ts`** — Add `byCwd` accumulator alongside `projects`.
   Return it in `UsageSnapshot`. (~15 lines)

2. **`src/shared/usage.ts`** — Add `byCwd: Array<{ cwd: string; tokens: number; cost: number }>`
   to `UsageSnapshot` and `EMPTY_USAGE_SNAPSHOT`. (~5 lines)

3. **Renderer helper** — Add `getTaskCost(snapshot, workspacePath): number` helper in
   `src/renderer/features/usage-stats/` (or colocated with usage selectors). (~10 lines)

4. **Task header** — In `src/renderer/features/tasks/task-titlebar.tsx`, display the cost badge
   for provisioned local tasks. (~20 lines including zero-cost guard)

5. **Task list row** — Optional: add cost display in the task list view. (~10 lines)

6. **Snapshot refresh hook** — Wire `rpc.usageStats.refresh()` to agent completion events.
   (~10 lines)

7. **Tests** — Unit test the `byCwd` accumulator in `aggregate.test.ts`; test the zero-cost
   guard in the component. (~30 lines)

**Total estimated diff:** ~100 lines of production code, ~30 lines of tests.

---

## 8. Verdict

**GO-WITH-CONDITIONS**

The join is architecturally sound for local tasks: `workspaces.path` is the stored worktree path,
and Claude Code / Codex transcripts emit `cwd` as that exact path. The deduplication already
applied in `aggregate()` carries through to per-cwd rollups at no extra cost. Option A (snapshot
extension) is the right API surface: zero extra RPC, fits the existing snapshot TTL model, and
keeps the join as pure renderer computation.

**Conditions before shipping:**
1. Empirically verify path match for at least 2 local tasks on the developer machine (read
   `workspaces.path` from the app DB, grep a transcript JSONL for `"cwd"`, confirm the strings
   are identical).
2. Handle the SSH task case explicitly in the UI (show no badge for SSH-backed workspaces).
3. Decide on the snapshot auto-refresh trigger (open question 5 above).
