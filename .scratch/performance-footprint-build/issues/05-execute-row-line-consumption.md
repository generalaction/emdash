# 05 — Execute row: line-based consumption and a single truncation indicator

**What to build:** the chat execute row renders live terminal output from the client store's
line array directly — no full-text join, no per-update re-split, and natural-width
measurement is incremental (only new lines are measured, tracked as a running maximum).
When output has been truncated anywhere upstream (source ring buffer or client cap), the row
shows one "earlier output truncated" affordance; the two flags are collapsed at presentation
and never distinguished in the UI.
Spec: [terminal output decision, parts 3–4](../../performance-footprint/issues/01-agent-terminal-output-stream.md).

**Blocked by:** 04 — Terminal output, client store.

**Status:** done

- [x] Execute presenter/def consume the line array; no code path joins the full text per update
- [x] Width measurement work per update is proportional to new lines only
- [x] A single truncation indicator appears when either truncation flag is set
- [x] Existing execute row tests updated; the chat-ui perf harness shows per-chunk cost no
      longer scales with total accumulated output

**Implementation notes:** chat state now carries `TerminalOutputSnapshot` (lines array +
collapsed truncated flag + per-flush version) instead of joined text; `SegmentCtx` exposes
`terminalOutput()` and the old `terminalOutputText` path was removed end to end (the dead
`ConnectSessionSource.terminalOutputs` map sync went with it). `execute-lines.ts` owns the
incremental display-line memo (unchanged rows keep object identity so the keyed <For> does not
recreate DOM rows) and `maxOutputLineWidth` (running-max width; committed lines measured once,
only the growing tail re-measured). The renderer binding pushes one snapshot per
frame-coalesced store flush and ORs the agent-side `TerminalState.truncated` metadata flag
into the display-side flag; the row renders a single italic "… earlier output truncated"
line. Perf coverage: `src/tests/perf/execute-stream.perf.test.tsx` streams 6000 lines through
presenter+measure and asserts late/early per-chunk cost ratio stays < 4 (measured ~1x
locally; the pre-change path grows linearly).
