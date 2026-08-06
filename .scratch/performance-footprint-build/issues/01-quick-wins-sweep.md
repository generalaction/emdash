# 01 — Quick-wins sweep

**What to build:** the four no-decision idle-work items the performance map condemned are gone:
the CLI spinner no longer tears down and recreates its interval on every animation frame, the
tmux idle sweep no longer spawns a process when there are zero tracked sessions, the ACP raw
protocol log gets a byte cap so a chatty session can't grow it without bound, and the stale
module paths in `AGENTS.md` are corrected. No user-visible behavior changes — the app just does
less work while idle. Inventory and rationale:
[map — quick wins decision](../../performance-footprint/map.md).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] Spinner keeps a single interval for its lifetime instead of one per frame
- [x] Idle sweep short-circuits before spawning when no tmux sessions are tracked
- [x] ACP raw log retention is byte-capped; oldest entries evicted, cap covered by a test
- [x] `AGENTS.md` module paths match the current tree
- [x] `pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test` unaffected
