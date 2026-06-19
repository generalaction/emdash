/**
 * Wraps an async producer so that concurrent calls share a single in-flight
 * promise. Each settle (resolve or reject) clears the shared promise, so a later call
 * starts a fresh fetch
 */
export function coalesce<T>(producer: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    inFlight = producer().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
