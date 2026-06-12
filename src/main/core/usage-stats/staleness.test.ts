import { describe, expect, it } from 'vitest';
import { isSnapshotStale } from './staleness';

describe('isSnapshotStale', () => {
  const TTL = 5 * 60_000; // 5 minutes
  const nowMs = Date.now();

  it('returns false for a fresh timestamp (within TTL)', () => {
    const recent = new Date(nowMs - 60_000).toISOString(); // 1 minute ago
    expect(isSnapshotStale(recent, nowMs, TTL)).toBe(false);
  });

  it('returns true for a timestamp older than TTL', () => {
    const old = new Date(nowMs - TTL - 1).toISOString(); // 1ms past TTL
    expect(isSnapshotStale(old, nowMs, TTL)).toBe(true);
  });

  it('returns true for an empty string', () => {
    expect(isSnapshotStale('', nowMs, TTL)).toBe(true);
  });

  it('returns true for a garbage string', () => {
    expect(isSnapshotStale('not-a-date', nowMs, TTL)).toBe(true);
  });

  it('returns false when exactly at the boundary (nowMs - t === ttlMs)', () => {
    const boundary = new Date(nowMs - TTL).toISOString();
    expect(isSnapshotStale(boundary, nowMs, TTL)).toBe(false);
  });
});
