const VISIBLE_DRAIN_FALLBACK_MS = 48;

function getVisibilityState(): DocumentVisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState;
}

export function scheduleTerminalWriteDrain(run: () => void): () => void {
  let finished = false;
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  const cancelPending = () => {
    if (frameId !== null && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const finish = () => {
    if (finished) return;
    finished = true;
    cancelPending();
    run();
  };

  const canUseAnimationFrame =
    getVisibilityState() === 'visible' &&
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function';

  if (canUseAnimationFrame) {
    frameId = requestAnimationFrame(() => {
      finish();
    });
    timeoutId = setTimeout(() => {
      finish();
    }, VISIBLE_DRAIN_FALLBACK_MS);
  } else {
    timeoutId = setTimeout(() => {
      finish();
    }, 0);
  }

  return () => {
    if (finished) return;
    finished = true;
    cancelPending();
  };
}
