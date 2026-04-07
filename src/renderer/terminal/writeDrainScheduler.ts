const VISIBLE_DRAIN_FALLBACK_MS = 48;

function getVisibilityState(): DocumentVisibilityState {
  if (typeof document === 'undefined') return 'visible';
  return document.visibilityState;
}

export function scheduleTerminalWriteDrain(run: () => void): () => void {
  let frameId: number | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let isCancelled = false;

  const cleanup = () => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const execute = () => {
    if (isCancelled) return;
    cleanup();
    run();
  };

  const canUseAnimationFrame =
    getVisibilityState() === 'visible' && typeof requestAnimationFrame === 'function';

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
