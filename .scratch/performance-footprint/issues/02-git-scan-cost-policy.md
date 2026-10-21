# Workspace git-scan cost policy under sustained writes

Type: grilling
Status: resolved

## Question

Any file event in an active worktree triggers a full workspace scan — ~5–6 git
subprocesses plus reading every untracked file to count lines (up to 5,000 files × 5 MB) —
debounced at only 250 ms for active workspaces (diagnosis §2;
`packages/core/src/runtimes/workspace-registry/node/scan/observe-git.ts:82-114`,
`scan/scheduler.ts:115-122`). An agent writing files continuously means this fires near
its floor, per active workspace, and parallel active workspaces are the product's premise.

Decide the scan cost budget and how to hit it:

- What freshness do consumers of scan results actually need while an agent is
  mid-write-burst — is 250 ms buying anything a 1–2 s adaptive debounce wouldn't?
- Should the debounce adapt under sustained activity (backoff while events keep arriving,
  snap-to-fresh on quiescence)?
- Untracked line counting: cache per file keyed on `(path, mtime, size)`, cap total bytes
  read per scan, or drop line counts for untracked files entirely — who consumes those
  numbers and at what fidelity?
- Is the 5-minute poll floor for unobserved records still needed once watcher coverage is
  trusted, or is it belt-and-braces worth keeping?

## Answer

Resolved 2026-08-06. Facts established during resolution that correct the diagnosis's
framing: the scheduler already has a cheap refs-only path (`observeWorkspaceGitRefs` —
no status, no untracked reads), full-beats-refs request coalescing, an in-flight guard
with rerun-after-flight, and a **non-extending** debounce window — so the true burst
cadence is ~(scan duration + debounce), serialized per workspace. `isActive` means
"activated workspace" (ran setup scripts — effectively every workspace with a running
agent task), and `dirty`/`diffStats` feed task-card badges (`getTasks`,
`getProjectWorkspaces`) plus a delete preflight that re-checks on demand.

Three decisions:

1. **Active debounce rises 250 ms → 1 s** (idle stays 2 s); no adaptive mechanism.
   Task-card badges trailing a write burst by ≤1 s + scan time is imperceptible, the
   burst-end state converges via the existing rerun-after-flight path, and steady-state
   subprocess load drops to roughly a quarter. One-constant change.
2. **Untracked line counting stays, made cheap: stat-keyed cache + byte budget.** Per
   untracked file, cache the line count keyed on `(path, mtime, size)`; each scan does
   one `lstat` per file and re-reads only files whose stat changed (agent bursts touch
   few files repeatedly — hits dominate). A total-bytes-read budget per scan (a few tens
   of MB) bounds the worst case (first scan of a huge vendored tree), degrading the
   untracked component to `null` via the existing degrade semantics — the same pattern
   `UNTRACKED_FILES_MAX` uses today. The per-file 5 MB skip and 5,000-file bail stay.
   Cache lives in the scan runtime per workspace, evicted when the record goes missing.
   Dropping the count entirely was rejected: agent worktrees are full of fresh untracked
   files, so untracked lines *are* the +N badge in the common case.
3. **The 5-minute poll floor stays unchanged.** It is the only staleness bound when
   watchers fail or are absent (the scheduler explicitly supports watcherless hosts;
   ADR 0005 frames the floor as the guarantee), and after decision 2 an idle floor scan
   is mostly stat calls plus a handful of git spawns per workspace per 5 minutes.

Also settled: the map's fog item about moving to incremental status (porcelain v2
deltas / status caching) dissolves — the stat-keyed cache achieves the cost goal while
staying spawn-per-scan; no architecture change is warranted.
