import { MAX_SEEN_ISSUES, MAX_SEEN_PRS, type PollerCursor } from './types';

const PR_STATUSES: ReadonlySet<string> = new Set(['open', 'closed', 'merged']);

function isRepoEventState(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v.etag !== undefined && typeof v.etag !== 'string') return false;
  if (v.lastSyncedAt !== undefined && typeof v.lastSyncedAt !== 'string') return false;
  return true;
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
  if (v.repoStates !== undefined) {
    if (typeof v.repoStates !== 'object' || v.repoStates === null) return false;
    for (const state of Object.values(v.repoStates as Record<string, unknown>)) {
      if (!isRepoEventState(state)) return false;
    }
  }
  return true;
}

function looksLikeIssueUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

export function parseCursor(raw: string | null): PollerCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPollerCursor(parsed)) return null;
    // Migrate legacy cursors that stored `#N` identifiers instead of issue URLs.
    // Reseed without emitting to avoid replaying every currently-open issue.
    if (parsed.seenIssueIds && parsed.seenIssueIds.some((id) => !looksLikeIssueUrl(id))) {
      return { ...parsed, initialized: false, seenIssueIds: [] };
    }
    return parsed;
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
