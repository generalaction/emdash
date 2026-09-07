# 04 — Terminal output, client store: capped line-structured stream

**What to build:** the renderer's cost of receiving a terminal output chunk becomes O(chunk)
instead of O(total output), and renderer memory per terminal is bounded. The client-side log
store mirrors the source's 1 MB cap (evicting whole oldest lines and raising a client
truncation flag), stores output as an incrementally-maintained line array rather than one
growing string, guards against pathological single lines with a max-line-length cutoff, and
coalesces burst appends so subscribers are notified at most once per animation frame.
Spec: [terminal output decision, parts 3–4](../../performance-footprint/issues/01-agent-terminal-output-stream.md).

**Blocked by:** 03 — Terminal output, main side.

**Status:** done

- [x] Client log store retains at most the mirrored byte cap; eviction sets a truncation flag
- [x] Appends update a line array incrementally (no re-split, no full-string rebuild)
- [x] Lines longer than the cutoff are hard-wrapped or clamped before storage
- [x] Subscriber notifications are frame-coalesced under burst input, covered by a test
- [x] Store unit tests cover cap, eviction, partial-line continuation, and coalescing

**Implementation notes:** `createLineLogStore` lives at `packages/wire/src/live/log/line-store.ts`
and satisfies the `ReplicaLog` store contract (`reset`/`append`/`text`). The byte cap is shared
with the source via the exported `LIVE_LOG_DEFAULT_MAX_BUFFER_BYTES` (1 MB) so source and client
cannot drift. Lines are hard-wrapped at 4096 UTF-16 units. Flushes default to
`requestAnimationFrame` (16 ms timeout fallback outside the renderer) and are injectable for
tests. App-side consumption of the line array lands with ticket 05.
