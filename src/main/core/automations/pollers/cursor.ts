import { MAX_SEEN_ISSUES, MAX_SEEN_PRS, type PollerCursor } from './types';

const PR_STATUSES: ReadonlySet<string> = new Set(['open', 'closed', 'merged']);

export function emptyCursor(): PollerCursor {
  return { initialized: false, seenIssueIds: [], seenPrs: {} };
}

function isPollerCursor(value: unknown): value is PollerCursor {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.initialized !== undefined && typeof v.initialized !== 'boolean') return false;
  if (v.seenIssueIds !== undefined) {
    if (!Array.isArray(v.seenIssueIds)) return false;
    if (!v.seenIssueIds.every((id) => typeof id === 'string')) return false;
  }
  if (v.seenPrs !== undefined) {
    if (typeof v.seenPrs !== 'object' || v.seenPrs === null) return false;
    for (const status of Object.values(v.seenPrs as Record<string, unknown>)) {
      if (typeof status !== 'string' || !PR_STATUSES.has(status)) return false;
    }
  }
  return true;
}

export function parseCursor(raw: string | null): PollerCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isPollerCursor(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function serializeCursor(cursor: PollerCursor): string {
  return JSON.stringify(cursor);
}

/** Append new IDs to the seen list, capping the total length (oldest first eviction). */
export function trackSeenIssueIds(prev: string[] | undefined, newIds: string[]): string[] {
  const set = new Set(prev ?? []);
  for (const id of newIds) set.add(id);
  const arr = Array.from(set);
  if (arr.length > MAX_SEEN_ISSUES) {
    return arr.slice(arr.length - MAX_SEEN_ISSUES);
  }
  return arr;
}

export function trackSeenPrs(
  prev: Record<string, 'open' | 'closed' | 'merged'> | undefined,
  updates: Record<string, 'open' | 'closed' | 'merged'>
): Record<string, 'open' | 'closed' | 'merged'> {
  const next = { ...(prev ?? {}), ...updates };
  const entries = Object.entries(next);
  if (entries.length > MAX_SEEN_PRS) {
    return Object.fromEntries(entries.slice(entries.length - MAX_SEEN_PRS));
  }
  return next;
}
