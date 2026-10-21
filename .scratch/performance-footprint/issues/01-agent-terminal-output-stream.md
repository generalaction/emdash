# Agent terminal output: one capped stream end to end

Type: grilling
Status: resolved

## Question

ACP agent-terminal output is buffered unboundedly twice, with quadratic copying on both
sides of the wire (diagnosis §1). Main side: `TerminalLiveRegistry.onTerminalOutput`
(`packages/core/src/runtimes/acp/node/runtime/terminal-live-registry.ts:43-54`) grows
`state.output` by full-string concat per chunk with no cap and republishes conversation
state per chunk — even though the adjacent `record.log` (`LiveLogSource`, 1 MB cap) is
documented as the authoritative stream. Renderer side: `bindSessionTerminalOutputs`
(`apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-terminal-output-binding.ts:49-51`)
pushes `binding.text()` — the full accumulated text — into chat state on every append,
backed by concat-per-chunk in `packages/wire/src/live/mobx/mobx-log-store.ts`.

Decide the end-to-end shape:

- Does `state.output` go away entirely in favor of the capped `LiveLogSource`, or shrink
  to a capped tail? What do `snapshotConversation` consumers actually need?
- What is the cap and what are the truncation semantics — how does the app-level cap
  compose with the ACP protocol's `truncated` flag and `ManagedAcpTerminal`'s 4 MB ring
  buffer upstream?
- How does the renderer consume appends as deltas instead of re-reading full text per
  chunk? What chat-state shape supports appends without re-rendering the accumulated
  output (the transcript itself is already virtualized — the problem is the state push,
  not the render)?
- Per-chunk `onConversationChanged` republish: coalesce, or is it cheap once `state.output`
  is gone?

## Answer

Resolved 2026-08-06. Facts established during resolution that sharpen the original
diagnosis: the unbounded `state.output` has **zero consumers** (`snapshotConversation` is
never called — dead code); the published terminals LiveModel snapshots every terminal
(joining up to 4 MB each) **per output chunk** via `SessionManager.syncTerminals`; and the
client-side `createMobxLogStore` is unbounded even though `LiveLogSource` caps at 1 MB,
because source eviction bounds only retention/late-join snapshots — the delta stream is
append-only.

Four decisions:

1. **The log stream is the only output-text path to clients.** Delete `state.output` and
   `snapshotConversation` from `TerminalLiveRegistry` (dead code). Strip `output` from the
   `TerminalState` published via the terminals LiveModel — metadata/status only (command,
   args, cwd, truncated, exitStatus). Stop firing the per-chunk conversation republish:
   republish only on create / exit / truncation-transition. `ManagedAcpTerminal`'s 4 MB
   ring buffer stays untouched as the agent-facing ACP surface (`terminal/output`
   requests). Implementation must verify no UI reads `TerminalState.output` (tracing
   found none — the renderer binding reads only `terminalId`).
2. **One cap, mirrored.** The client log store (`createMobxLogStore` layer) evicts to the
   same 1 MB tail as `LiveLogSource`, with the cap shared (constant or snapshot metadata)
   so client and source cannot drift. Long-lived subscribers and late joiners converge on
   identical state.
3. **Line-structured incremental client store with frame-coalesced appends.** The client
   store maintains a split-lines array: appends process only the new chunk (merging the
   partial last line), evictions trim from the front as the byte cap requires; appends
   arriving within a frame are batched before notifying. The execute row consumes the
   line array directly and width-overflow tracking becomes an incremental running max —
   per-chunk work drops from O(buffer) to O(chunk). `ChatSessionSnapshot.terminalOutputText`
   may remain for compatibility; the presenter gains a line-based accessor. Spec guard:
   cap measured line length so a single-line rewrite stream (progress bars) cannot blow
   up measurement.
4. **Truncation collapses at presentation.** Two flags survive with distinct meanings —
   agent-side (ManagedAcpTerminal ring / `outputByteLimit`; rides `TerminalState`
   metadata, ACP-defined) and display-side (1 MB stream cap). The execute row shows one
   "earlier output truncated" affordance when either is set; both flags stay in the model.

Also settled: the map's fog item "does chat state need a general streaming-delta
primitive" dissolves — the line-structured log store *is* that primitive, and no other
chat-state stream needs one today (the transcript is already incremental).
