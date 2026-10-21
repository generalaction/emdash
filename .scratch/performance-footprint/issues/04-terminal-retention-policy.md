# Off-screen terminal retention and scrollback policy

Type: grilling
Status: resolved

## Question

Every PTY terminal is created with 100,000 lines of scrollback
(`apps/emdash-desktop/src/core/features/terminals/api/browser/pty/pty.ts:15`) and on
unmount is reparented to an off-screen host rather than disposed, deliberately, so
scrollback and the Canvas2D renderer survive tab switches
(`terminals/browser/pty/use-pty.ts:71-76`). Renderer memory therefore scales with every
terminal ever opened in the session (diagnosis §4).

Decide the retention policy without losing the instant-restore UX the reparenting buys:

- LRU cap on live off-screen terminals — how many, and what happens on eviction?
- Serialize-and-dispose for evicted terminals (xterm serialize addon), rehydrating on
  refocus — is the restore latency acceptable, and does serialization preserve enough
  (TUI apps mid-frame)?
- Is 100k scrollback the right number anywhere? What do users actually scroll —
  5–10k is typical elsewhere. (Note `AgentSignInModal.tsx:170` hardcodes a second 100k
  instance.)
- The 1 MB main-side `LiveLogSource` cap already bounds what a rehydrated terminal could
  replay — does that argue for matching the renderer bound to it?

## Answer

Resolved 2026-08-06. Lifecycle facts established: `FrontendPty` is disposed only when its
terminal/conversation entity is *deleted* (`pty.ts:67-70`) — every live task's terminals
persist off-screen indefinitely with buffer + Canvas2D renderer. And the main side
retains only 1 MB of output per PTY session for replay, so deep scrollback already does
not survive an app restart — 100k lines was never a durable promise.

Two decisions:

1. **Scrollback drops 100,000 → 10,000 lines** for task terminals (`SCROLLBACK_LINES`),
   and the hardcoded second 100k instance in `AgentSignInModal` drops to **1,000**.
   Rationale: the 1 MB replay bound makes the deep tail ephemeral anyway; 10k is an order
   of magnitude beyond realistic scroll review; ~10× cut in the dominant per-terminal
   memory cost for a one-constant change. The "terminal scrollback as audit trail"
   counterargument fails here — the ACP transcript is the durable record in this product.
2. **Off-screen terminals keep their text buffer but release the renderer.** Dispose the
   canvas addon in `FrontendPty.unmount`, re-instantiate on `mount`; the xterm `Terminal`
   and buffer stay intact so restore is instant and pixel-faithful (no serialize/
   rehydrate, no TUI alt-screen fidelity risk). Renderer bitmap memory (several
   full-viewport canvas layers, ~10 MB/terminal) then scales with *visible* terminals
   instead of all terminals ever opened. Spec note: verify xterm does not fall back to an
   active DOM renderer doing work while parked in the off-screen host (keep the host
   `display:none` or equivalent so no renderer runs off-screen). Full LRU with
   serialize-and-dispose is **explicitly rejected for now** — complexity, restore
   latency, and mid-frame TUI serialization risk for marginal gain after decisions 1+2;
   revisit only if the map's measurement work later shows off-screen text buffers
   dominating renderer memory.
