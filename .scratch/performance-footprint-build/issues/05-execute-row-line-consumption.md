# 05 — Execute row: line-based consumption and a single truncation indicator

**What to build:** the chat execute row renders live terminal output from the client store's
line array directly — no full-text join, no per-update re-split, and natural-width
measurement is incremental (only new lines are measured, tracked as a running maximum).
When output has been truncated anywhere upstream (source ring buffer or client cap), the row
shows one "earlier output truncated" affordance; the two flags are collapsed at presentation
and never distinguished in the UI.
Spec: [terminal output decision, parts 3–4](../../performance-footprint/issues/01-agent-terminal-output-stream.md).

**Blocked by:** 04 — Terminal output, client store.

**Status:** ready-for-agent

- [ ] Execute presenter/def consume the line array; no code path joins the full text per update
- [ ] Width measurement work per update is proportional to new lines only
- [ ] A single truncation indicator appears when either truncation flag is set
- [ ] Existing execute row tests updated; the chat-ui perf harness shows per-chunk cost no
      longer scales with total accumulated output
