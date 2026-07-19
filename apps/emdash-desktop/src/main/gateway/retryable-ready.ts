export function createRetryableReady(initialize: () => Promise<void>): () => Promise<void> {
  let readyPromise: Promise<void> | undefined;

  return () => {
    if (!readyPromise) {
      readyPromise = Promise.resolve()
        .then(initialize)
        .catch((error) => {
          readyPromise = undefined;
          throw error;
        });
    }
    return readyPromise;
  };
}
