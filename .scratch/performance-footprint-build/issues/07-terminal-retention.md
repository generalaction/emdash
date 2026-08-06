# 07 — Terminal retention

**What to build:** renderer memory stops scaling with the number of terminals a user has ever
opened. Scrollback drops from 100k lines to 10k (the sign-in modal terminal to 1k), and an
off-screen terminal releases its Canvas2D renderer when its view unmounts, re-attaching
cleanly — with buffer and scroll position intact — when the user navigates back. Off-screen
terminals keep receiving PTY data into their (now smaller) buffers; they just stop holding
GPU-backed canvases.
Spec: [terminal retention decision](../../performance-footprint/issues/04-terminal-retention-policy.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** ready-for-agent

- [ ] Scrollback constants: 10k default, 1k for the sign-in modal terminal
- [ ] Renderer addon disposed on view unmount, recreated on mount; no leaked canvases after
      repeated mount/unmount cycles
- [ ] Buffer contents and scroll position survive an unmount/remount round trip, covered by a
      browser-project test
- [ ] Before/after renderer RSS with ~10 open terminals recorded in the PR
