const VISIBLE_DRAIN_FALLBACK_MS = 48;

function getVisibilityState(): DocumentVisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState;
}

export function scheduleTerminalWriteDrain(run: () => void): () => void {
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isCancelled = false;
  let hasRun = false;

  const canUseAnimationFrame =
    getVisibilityState() === 'visible' &&
    typeof requestAnimationFrame === 'function' &&
    typeof cancelAnimationFrame === 'function';

  const cleanup = () => {
    if (frameId !== null) {
      if (canUseAnimationFrame) {
        cancelAnimationFrame(frameId);
      }
      frameId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const execute = () => {
    if (isCancelled || hasRun) return;
    hasRun = true;
    cleanup();
    run();
  };

  if (canUseAnimationFrame) {
    frameId = requestAnimationFrame(execute);
    timeoutId = setTimeout(execute, VISIBLE_DRAIN_FALLBACK_MS);
  } else {
    timeoutId = setTimeout(execute, 0);
  }

  return () => {
    isCancelled = true;
    cleanup();
  };
}
