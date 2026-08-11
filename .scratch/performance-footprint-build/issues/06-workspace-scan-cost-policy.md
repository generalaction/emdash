# 06 — Workspace scan cost policy

**What to build:** an agent writing files in a worktree no longer triggers a git-spawn storm.
Three changes land together: the active-workspace scan debounce rises to 1 second (idle tiers
unchanged, 5-minute poll floor kept); `FETCH_HEAD` and `ORIG_HEAD` writes are reclassified as
ignorable in the git-dir event classification so the background fetch loop stops triggering
full rescans of every workspace; and untracked-file line counting gets a stat-keyed cache
(path + size + mtime) with a per-scan byte budget so unchanged files are never re-read and a
giant untracked file can't dominate a scan. Verified against the spawn counter from ticket 02:
spawns/minute during an agent write burst drops roughly 4×, and badges still converge to
correct values.
Specs: [scan cost decision](../../performance-footprint/issues/02-git-scan-cost-policy.md),
[fetch fan-out decision](../../performance-footprint/issues/03-fetch-ref-fanout.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** done

- [x] Active debounce is 1 s; scheduler tests updated with the injected clock
- [x] `FETCH_HEAD`/`ORIG_HEAD` events classified ignorable, covered by classification tests;
      the 2-minute fetch cadence itself is unchanged
- [x] Untracked line-count cache hits on unchanged files (stat-keyed) and respects a per-scan
      byte budget, covered by temp-repo integration tests
- [ ] Before/after spawns-per-minute numbers from ticket 02 recorded in the PR
      — *not measured: requires attaching to a live GUI run with an agent write burst, which
      this environment cannot do. The ticket-02 instruments (debug-log spawn counts per
      minute, tagged `git`) are in place to capture the numbers on the first dev run.
      Analytically, the debounce change alone caps the active-workspace burst cadence at
      1/4 of the previous rate (250 ms → 1 s coalescing window, same ~6-spawn scan).*

**Implementation notes:** scheduler defaults are exported as `DEFAULT_SCAN_DEBOUNCE_MS` (2 s)
and `DEFAULT_ACTIVE_SCAN_DEBOUNCE_MS` (1 s) and asserted by tests; the existing scheduler
tests use short injected debounce values with the same seams. `FETCH_HEAD`/`ORIG_HEAD` are
skipped in `onGitDirEvents` before classification, so a no-change fetch triggers nothing while
`packed-refs`/`refs/remotes/*` still fan out refs scans. `countUntrackedLines` now stats every
file, serves `(size, mtimeMs)` matches from a per-record cache owned by the runtime (evicted
in `recordVanished`/`deleteWorkspaceLocked`, entries dropped when files stop being untracked),
and degrades the untracked component to null when a scan would read more than 32 MB; the
5 MB per-file skip and 5,000-file bail are unchanged.
