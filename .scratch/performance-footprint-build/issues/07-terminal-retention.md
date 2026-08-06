# 07 — Terminal retention

**What to build:** renderer memory stops scaling with the number of terminals a user has ever
opened. Scrollback drops from 100k lines to 10k (the sign-in modal terminal to 1k), and an
off-screen terminal releases its Canvas2D renderer when its view unmounts, re-attaching
cleanly — with buffer and scroll position intact — when the user navigates back. Off-screen
terminals keep receiving PTY data into their (now smaller) buffers; they just stop holding
GPU-backed canvases.
Spec: [terminal retention decision](../../performance-footprint/issues/04-terminal-retention-policy.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** done

- [x] Scrollback constants: 10k default, 1k for the sign-in modal terminal
- [x] Renderer addon disposed on view unmount, recreated on mount; no leaked canvases after
      repeated mount/unmount cycles
      — *Adapted (see notes): the decision's canvas-addon premise is stale. The app runs
      xterm v6's DOM renderer with no canvas addon anywhere (deliberately, to avoid resize
      flicker — `pty.ts`), so there are no GPU-backed canvas layers to dispose. The decision's
      actual goal — no renderer running while parked off-screen — is met structurally: xterm
      v6's `RenderService` pauses itself via `IntersectionObserver` when the terminal has zero
      viewport intersection, which the 1×1 off-viewport host guarantees. A browser test proves
      rendering stops while parked, resumes on remount, and that repeated mount/unmount cycles
      leak no canvases or terminal elements.*
- [x] Buffer contents and scroll position survive an unmount/remount round trip, covered by a
      browser-project test (`src/renderer/tests/browser/terminal-retention.test.ts`)
- [ ] Before/after renderer RSS with ~10 open terminals recorded in the PR
      — *Not captured: requires attaching to a live GUI run with ~10 populated terminals.
      The ticket-02 dev instruments (`EMDASH_DEV_PERF=1` RSS log + dev process panel) are in
      place to record this during a manual smoke pass. The expected effect is a ~10× cut in
      per-terminal text-buffer memory (10k vs 100k line cap).*

## Implementation notes

- `SCROLLBACK_LINES` 100,000 → 10,000 in
  `apps/emdash-desktop/src/core/features/terminals/api/browser/pty/pty.ts`; the sign-in modal
  terminal (`AgentSignInModal.tsx`) 100,000 → 1,000.
- **Deviation from decision 2 (documented):** the spec assumed a Canvas2D renderer addon whose
  bitmap layers (~10 MB/terminal) should be disposed on unmount. That addon does not exist in
  this codebase — it was never part of the monorepo (checked history) and `pty.ts` explicitly
  keeps xterm on its DOM renderer to avoid resize flicker. In xterm v6, the core render
  service already pauses when the terminal's screen element has zero intersection with the
  viewport (`refreshRows` early-returns while `_isPaused`, resuming with a full refresh on
  re-intersection). Since parked terminals live in the fixed `1px × 1px` host at
  `left: -10000px`, they are always paused. The spec's fallback note ("keep the host
  `display:none` or equivalent so no renderer runs off-screen") is therefore satisfied by the
  existing host + xterm's built-in pause; `display:none` itself would break xterm's cell
  measurement on open, so the off-viewport host is the correct equivalent.
- New browser-project test `terminal-retention.test.ts` locks in the retention contract:
  10k scrollback cap; buffer contents + scroll position identical across unmount/remount;
  zero `onRender` events while parked (writes flow into the buffer only) with rendering
  resuming on remount; and stable canvas/`.xterm` element counts across 10 mount/unmount
  cycles.
