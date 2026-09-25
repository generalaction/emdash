/**
 * Shared lightweight DOM helpers for imperative operations in components.
 */

export function scheduleIdle(fn: () => void): number {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(fn);
  }
  return window.setTimeout(fn, 0) as unknown as number;
}

export function cancelIdle(handle: number): void {
  if (typeof cancelIdleCallback === 'function') {
    cancelIdleCallback(handle);
  } else {
    clearTimeout(handle);
  }
}

/**
 * Reusable idle-yield driver for incremental work (e.g. budget-bounded
 * highlighting): `waitIdle()` resolves on the next idle callback; `cancel()`
 * clears any pending callback so a disposed caller stops waking up.
 */
export function createIdleYield(): { waitIdle: () => Promise<void>; cancel: () => void } {
  let handle: number | null = null;
  return {
    waitIdle: () =>
      new Promise<void>((resolve) => {
        handle = scheduleIdle(() => {
          handle = null;
          resolve();
        });
      }),
    cancel: () => {
      if (handle !== null) cancelIdle(handle);
      handle = null;
    },
  };
}
