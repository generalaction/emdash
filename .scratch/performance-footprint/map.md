# Performance footprint decisions

Label: wayfinder:map

## Destination

Every hotspot from the 2026-08-06 performance/memory diagnosis resolves to a locked
decision with a spec ready to hand off — including a durable measurement/regression-signal
story — nothing left to decide before implementation sessions land the fixes. Decisions
only: no fixes happen inside this map.

**Status: complete (2026-08-06).** All eight tickets are resolved and no fog remains.
Implementation hands off from the phased plan in
[Implementation sequencing for the performance fixes](issues/08-implementation-sequencing.md).

## Notes

- Domain: runtime performance and memory footprint of the desktop app — ACP terminal
  output buffering, workspace git scanning, fetch scheduling, xterm retention, preview
  probing, and continuous measurement.
- Evidence base: [diagnosis](assets/diagnosis.md) — verified findings with file/line
  citations, the polling inventory, what's already healthy, and reusable measurement
  techniques. Zoom there before re-deriving facts.
- Skills every session should consult: `/grilling`, `/domain-modeling`,
  `/codebase-design` (deep-module vocabulary for seam decisions).
- Standing preference: decisions, not deliverables. Each resolution is a decision + spec
  for a future implementation session.
- Quick wins needing no decision (execute anytime outside this map): `CLISpinner`
  recreating its 80 ms interval every tick; TUI idle sweep spawning `tmux` every 60 s with
  zero sessions; ACP raw event log capped by entries (50k) but not bytes; stale
  `AGENTS.md` paths (`src/main/core/resource-monitor/`, `src/main/core/pty/` → moved
  under `packages/core/src/runtimes/` and `packages/core/src/services/pty/`).

## Decisions so far

<!-- one line per closed ticket: gist + link -->

- [Agent terminal output: one capped stream end to end](issues/01-agent-terminal-output-stream.md) —
  the log stream becomes the only output-text path (registry's unbounded buffer is
  caller-less dead code — delete it; strip `output` from the terminals LiveModel;
  republish on lifecycle transitions only); one 1 MB cap mirrored client-side;
  line-structured incremental client store with frame-coalesced appends; two truncation
  flags collapse into one indicator at presentation.
- [Workspace git-scan cost policy under sustained writes](issues/02-git-scan-cost-policy.md) —
  active debounce 250 ms → 1 s (no adaptive mechanism); untracked line counting kept but
  made cheap via a `(path, mtime, size)`-keyed cache plus a per-scan byte budget that
  degrades to `null`; the 5-minute poll floor stays as the watcher-failure backstop.
- [Fetch-loop ref fan-out across worktrees](issues/03-fetch-ref-fanout.md) — `FETCH_HEAD`/
  `ORIG_HEAD` become ignorable watcher events (no-change fetches trigger nothing; real
  ref updates keep the now-correct cheap fan-out); the 2-minute fetch cadence stays
  unconditional — residual cost negligible.
- [Off-screen terminal retention and scrollback policy](issues/04-terminal-retention-policy.md) —
  scrollback 100k → 10k lines (sign-in modal → 1k); off-screen terminals keep their text
  buffer but release the canvas renderer on unmount (re-attach on mount); full LRU
  serialize-and-dispose explicitly rejected for now.
- [Preview-URL probe lifecycle](issues/05-preview-probe-lifecycle.md) — adaptive probe
  cadence in `startProbe`: 1 s until first success, ~15 s steady-state, 1 s again after a
  failure so closure still lands within ~2 s; stop conditions unchanged.
- [Research: continuous performance monitoring options for Electron apps](issues/06-research-electron-perf-monitoring.md) —
  `app.getAppMetrics()` cannot see `child_process`-spawned workers (only `utilityProcess`
  children), so coverage needs per-worker self-sampling + a spawn-seam counter; cheap
  always-on primitives exist per process type; VS Code's precedent is on-demand `ps`
  polling and trigger-only profiling; full findings in
  [research/electron-perf-monitoring.md](research/electron-perf-monitoring.md).
- [Performance measurement and the regression signal](issues/07-measurement-and-regression-signal.md) —
  per-worker self-sampling over existing IPC (`utilityProcess` migration ruled out of
  scope); dev harness (`ps` process panel, tracing command, verbose spawn logs) + cheap
  always-on counters behind the telemetry opt-in with session sampling; regression signal
  of record is sampled field telemetry on named per-fix counters; CI perf gates rejected
  for now.
- [Implementation sequencing for the performance fixes](issues/08-implementation-sequencing.md) —
  the handoff plan: quick wins immediately; minimal spawn/RSS counters first for
  before/after numbers; four parallel fix lanes (terminal output; registry scanning with
  the fetch fix folded in; terminal retention; adaptive probe); full measurement surface
  last; each lane's done-criterion is its guarding metric shifting.

## Not yet specified

(empty — the map is complete; nothing remains to decide)

## Out of scope

- **Implementing the fixes** — the destination is decisions + specs; execution is
  follow-on work outside this map.
- **Machine hygiene** — the three orphaned global-nx `storybook` processes (each pinning
  a core for 10–22 days) were SIGKILLed on 2026-08-06; standing guidance is to launch nx
  via the repo (`pnpm exec nx ...`), never the global CLI. Not app work; no ticket.
- **The 1.76 TB virtual-memory number** — macOS address-space reservation, normal for
  every Electron process; nothing to fix (see [diagnosis](assets/diagnosis.md)).
- **General Electron hardening beyond the identified findings** — this effort resolves
  what the diagnosis surfaced; it adds no speculative optimization work.
