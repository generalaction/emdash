/**
 * Leading + trailing debounce for PTY resizes.
 *
 * measureAndResize() resizes the xterm grid SYNCHRONOUSLY (reflowing the
 * buffer).  A pure trailing debounce on the matching PTY resize left the child
 * TUI drawing against stale dimensions for the whole debounce window — its
 * in-place redraws (spinners, the input box) landed at the wrong rows and baked
 * overlapping output into scrollback that only a later full repaint cleared
 * (ENG-1577: "Claude Code output overlaps input field, fixed by resizing").
 *
 * Firing on the LEADING edge keeps the SIGWINCH the child receives in lockstep
 * with the xterm grid.  The leading flush consumes the pending value, so a lone
 * resize flushes exactly once; the trailing flush still captures the final
 * value of a burst (e.g. a continuous window drag), with the burst's middle
 * coalesced.
 */
export interface ResizeScheduler<T> {
  /** Record the latest value; flush immediately on the leading edge, else coalesce. */
  schedule: (value: T) => void;
  /** Drop any pending trailing flush (call on teardown). */
  cancel: () => void;
}

export function createResizeScheduler<T>(
  flush: (value: T) => void,
  trailingMs: number
): ResizeScheduler<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { value: T } | null = null;
  let lastFlushAt = Number.NEGATIVE_INFINITY;

  const fireTrailing = () => {
    timer = null;
    if (!pending) return;
    const v = pending.value;
    pending = null;
    lastFlushAt = Date.now();
    flush(v);
  };

  return {
    schedule(value: T) {
      const now = Date.now();
      // Leading edge: no burst in flight → flush now so the PTY stays in
      // lockstep with the synchronous xterm resize.  Otherwise coalesce; the
      // trailing flush delivers the burst's final value.
      if (timer === null && now - lastFlushAt >= trailingMs) {
        lastFlushAt = now;
        flush(value);
        return;
      }

      pending = { value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(fireTrailing, trailingMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
