export interface HasUpdatedAt {
  updatedAt?: string | null;
}

export function updatedAtToTimestamp(updatedAt?: string | null): number {
  if (!updatedAt) {
    return 0;
  }

  const parsed = Date.parse(updatedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortByUpdatedAtDesc<T extends HasUpdatedAt>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    return updatedAtToTimestamp(b.updatedAt) - updatedAtToTimestamp(a.updatedAt);
  });
}
