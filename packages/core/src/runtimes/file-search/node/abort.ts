export function abortReason(signal: AbortSignal, fallback: string): unknown {
  return signal.reason instanceof Error ? signal.reason : new Error(fallback);
}

export function throwIfAborted(signal: AbortSignal, fallback: string): void {
  if (signal.aborted) throw abortReason(signal, fallback);
}

export function waitWithSignal<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  fallback: string
): Promise<T> {
  if (signal.aborted) return Promise.reject(abortReason(signal, fallback));
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal, fallback));
    };
    const cleanup = (): void => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      }
    );
  });
}
