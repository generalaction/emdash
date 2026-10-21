# Fetch-loop ref fan-out across worktrees

Type: grilling
Status: resolved

## Question

`GitRepositoryFetchService` runs `git fetch` every 2 minutes per open project
(`apps/emdash-desktop/src/main/core/git/repository/fetch-service.ts:60`). Each fetch
writes `FETCH_HEAD`/refs, and the scan scheduler turns any ref event into a refs scan
(2 git subprocesses) for **every worktree of that repo**
(`packages/core/src/runtimes/workspace-registry/node/scan/scheduler.ts:165-173`) —
steady-state background churn of 1 + 2×N subprocesses every 2 minutes per project
(diagnosis §3).

Decide how self-inflicted ref writes are treated:

- Should a fetch the app itself initiated flow through the watcher path at all, or should
  the fetch service directly trigger one batched refs refresh with the result it already
  knows?
- If the watcher path stays, can ref events debounce/batch across worktrees of the same
  repo instead of queueing per-worktree scans?
- Is 2 minutes the right cadence at all — should fetch frequency track visibility/focus
  (active project fetches, backgrounded projects idle) the way scan debounce already
  distinguishes active workspaces?

## Answer

Resolved 2026-08-06. The load-bearing git fact: `git fetch` rewrites `FETCH_HEAD` on
**every** run even when nothing changed upstream, and the scheduler explicitly classifies
`FETCH_HEAD` as a refs trigger (`scheduler.ts:152`) — so the steady-state fan-out was a
guaranteed no-op every 2 minutes per project. When a fetch actually brings new refs,
`refs/remotes/*` / `packed-refs` change as separate events.

Two decisions:

1. **Reclassify `FETCH_HEAD` and `ORIG_HEAD` as ignorable** in the git-dir event
   classification. A no-change fetch then triggers nothing; a real ref update still fans
   out via `refs/remotes/*`/`packed-refs` — correct and wanted at that point, since every
   worktree's behind-count may genuinely have changed, and the refs scan is the cheap
   path (~3 spawns, debounced). The watcher stays the single refresh mechanism: manual
   fetches in a user's terminal behave identically, and no coupling is added between the
   app's fetch service and core's registry. The alternative (fetch service directly
   triggering a batched refresh) was rejected — second refresh path, and blind to
   fetches emdash didn't initiate.
2. **The 2-minute fetch cadence stays unconditional.** After decision 1 the residual
   cost is one fetch subprocess + network round-trip per project per 2 minutes with no
   fan-out — negligible; visibility gating was considered and rejected as not worth the
   plumbing.
