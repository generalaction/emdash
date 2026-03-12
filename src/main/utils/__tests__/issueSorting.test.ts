import { describe, expect, it } from 'vitest';
import { sortByUpdatedAtDesc, updatedAtToTimestamp } from '../issueSorting';

describe('updatedAtToTimestamp', () => {
  it('returns 0 for missing or invalid timestamps', () => {
    expect(updatedAtToTimestamp()).toBe(0);
    expect(updatedAtToTimestamp(null)).toBe(0);
    expect(updatedAtToTimestamp('not-a-date')).toBe(0);
  });

  it('parses valid ISO timestamps', () => {
    expect(updatedAtToTimestamp('2026-03-04T10:30:00.000Z')).toBe(1772620200000);
  });
});

describe('sortByUpdatedAtDesc', () => {
  it('sorts most recent updatedAt first', () => {
    const issues = [
      { id: 'old', updatedAt: '2026-03-01T00:00:00.000Z' },
      { id: 'newest', updatedAt: '2026-03-04T00:00:00.000Z' },
      { id: 'mid', updatedAt: '2026-03-02T00:00:00.000Z' },
    ];

    const sorted = sortByUpdatedAtDesc(issues);
    expect(sorted.map((issue) => issue.id)).toEqual(['newest', 'mid', 'old']);
  });

  it('pushes missing or invalid updatedAt to the end', () => {
    const issues = [
      { id: 'missing', updatedAt: null },
      { id: 'valid', updatedAt: '2026-03-04T00:00:00.000Z' },
      { id: 'invalid', updatedAt: 'bogus' },
    ];

    const sorted = sortByUpdatedAtDesc(issues);
    expect(sorted[0]?.id).toBe('valid');
    expect(new Set(sorted.slice(1).map((issue) => issue.id))).toEqual(
      new Set(['missing', 'invalid'])
    );
  });
});
