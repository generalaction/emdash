export function selectRetainedChatStore<T>(
  openStores: readonly T[],
  activeStore: T | null,
  retainedStore: T | null
): T | null {
  if (activeStore) return activeStore;
  if (retainedStore && openStores.includes(retainedStore)) return retainedStore;
  return openStores[0] ?? null;
}
