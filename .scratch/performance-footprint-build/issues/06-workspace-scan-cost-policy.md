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

**Status:** ready-for-agent

- [ ] Active debounce is 1 s; scheduler tests updated with the injected clock
- [ ] `FETCH_HEAD`/`ORIG_HEAD` events classified ignorable, covered by classification tests;
      the 2-minute fetch cadence itself is unchanged
- [ ] Untracked line-count cache hits on unchanged files (stat-keyed) and respects a per-scan
      byte budget, covered by temp-repo integration tests
- [ ] Before/after spawns-per-minute numbers from ticket 02 recorded in the PR
