import { useEffect, useRef } from 'react';
import { useNavigationHistory } from '@renderer/lib/layout/navigation-provider';

const SWIPE_THRESHOLD = 80;
const COOLDOWN_MS = 600;
const RESET_GAP_MS = 200;
const HORIZONTAL_RATIO = 1.4;

export const HISTORY_SWIPE_IGNORE_ATTR = 'data-history-swipe-ignore';

// Native scrollables (Monaco, terminal, horizontal diff) opt out via this selector
// so their internal horizontal scroll isn't hijacked by history navigation.
const IGNORE_SELECTOR = `[${HISTORY_SWIPE_IGNORE_ATTR}], input, textarea, [contenteditable="true"]`;

/** Two-finger horizontal trackpad swipe → back/forward navigation. */
export function useTrackpadHistorySwipe(): void {
  const { goBack, goForward, canGoBack, canGoForward } = useNavigationHistory();

  const stateRef = useRef({
    accumulator: 0,
    lastEventAt: 0,
    lockedUntil: 0,
  });
  const handlersRef = useRef({ goBack, goForward, canGoBack, canGoForward });

  useEffect(() => {
    handlersRef.current = { goBack, goForward, canGoBack, canGoForward };
  }, [goBack, goForward, canGoBack, canGoForward]);

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const dx = event.deltaX;
      const dy = event.deltaY;

      if (Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_RATIO) {
        stateRef.current.accumulator = 0;
        return;
      }

      const target = event.target;
      if (target instanceof Element && target.closest(IGNORE_SELECTOR)) {
        return;
      }

      const now = performance.now();
      const state = stateRef.current;

      if (now < state.lockedUntil) return;
      if (now - state.lastEventAt > RESET_GAP_MS) state.accumulator = 0;
      state.lastEventAt = now;

      state.accumulator += dx;

      const handlers = handlersRef.current;
      if (state.accumulator <= -SWIPE_THRESHOLD && handlers.canGoBack) {
        handlers.goBack();
        state.accumulator = 0;
        state.lockedUntil = now + COOLDOWN_MS;
      } else if (state.accumulator >= SWIPE_THRESHOLD && handlers.canGoForward) {
        handlers.goForward();
        state.accumulator = 0;
        state.lockedUntil = now + COOLDOWN_MS;
      }
    };

    window.addEventListener('wheel', onWheel, { passive: true });
    return () => window.removeEventListener('wheel', onWheel);
  }, []);
}
