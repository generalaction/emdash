# Implementation sequencing for the performance fixes

Type: grilling
Status: resolved
Blocked by: 01, 02, 03, 04, 05, 07

## Question

Once the decision tickets are resolved, produce the handoff plan: in what order do the
fixes land, what can run as parallel lanes, and what ships as quick wins immediately?

- Which fixes are independent lanes (terminal output stream, scan policy, fetch fan-out,
  terminal retention, probe lifecycle) and which share seams that force ordering?
- Does measurement (07) land *first* so before/after numbers exist for each fix, or
  alongside?
- Fold in the quick-wins list from the map Notes (spinner interval, tmux idle spawn,
  raw-log byte cap, AGENTS.md paths) — who executes those and when?
- Define done: which metric from 07 validates each fix.

## Answer

Resolved 2026-08-06. The handoff plan — the five fixes touch five disjoint seams, so the
plan is phases + parallel lanes:

**Phase 0 — quick wins, immediately, no ordering constraints.** The four items from the
map Notes: `CLISpinner` interval churn, tmux idle-sweep spawn with zero sessions, ACP
raw-log byte cap, stale `AGENTS.md` paths. Any session executes these today.

**Phase 1 — minimal before/after instruments, before any fix lands.** Only the
spawn-seam counter (git spawns/minute, logged locally) and a simple per-process RSS log
from the dev harness — enough to put numbers in each fix's PR. The full measurement
build-out does NOT block the fix lanes.

**Phase 2 — four parallel fix lanes:**

- **Lane A (largest; high-risk ACP area): agent terminal output**
  ([ticket 01](01-agent-terminal-output-stream.md)). Sub-order: main-side demolition
  (delete dead registry buffer, strip `output` from the LiveModel, lifecycle-only
  republish) → client store (mirrored 1 MB cap, line-structured incremental appends,
  frame coalescing) → execute row line-based consumption. Registry-hook tests move with
  it.
- **Lane B: workspace-registry scanning** ([02](02-git-scan-cost-policy.md) +
  [03](03-fetch-ref-fanout.md) folded in — both edits land in `scheduler.ts`/
  `observe-git.ts`, avoiding two PRs contending on one file): 1 s active debounce,
  stat-keyed untracked cache + byte budget, `FETCH_HEAD`/`ORIG_HEAD` reclassification.
- **Lane C: terminal retention** ([04](04-terminal-retention-policy.md)): scrollback
  constants (10k / 1k), renderer release/re-attach in `FrontendPty.mount`/`unmount`,
  off-screen-host rendering check.
- **Lane D: adaptive preview probe** ([05](05-preview-probe-lifecycle.md)): ~10 lines in
  `startProbe`.

**Phase 3 — full measurement surface, last** ([07](07-measurement-and-regression-signal.md)):
`ps`-based process panel, tracing capture command, telemetry opt-in wiring with session
sampling, dashboards for the named per-fix counters.

**Done-criteria:** each lane is complete when its guarding metric (per ticket 07's
mapping) shows the expected shift in the Phase 1 logs: spawns/minute for Lane B;
RSS trend + main event-loop delay for Lane A; terminal count × buffer bytes for Lane C;
probes/minute for Lane D.
