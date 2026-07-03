import { describe, expect, it } from 'vitest';
import { clampIssueLimit, issueError, normalizeSearchTerm } from './provider-inputs';

describe('clampIssueLimit', () => {
  it('uses fallback and clamps bounds', () => {
    expect(clampIssueLimit(undefined, 50, 100)).toBe(50);
    expect(clampIssueLimit(0, 50, 100)).toBe(1);
    expect(clampIssueLimit(120, 50, 100)).toBe(100);
  });
});

describe('normalizeSearchTerm', () => {
  it('trims and normalizes values', () => {
    expect(normalizeSearchTerm('  abc  ')).toBe('abc');
    expect(normalizeSearchTerm('')).toBe('');
  });
});

describe('issueError', () => {
  it('builds a typed error object', () => {
    expect(issueError('auth_failed', 'nope')).toEqual({ type: 'auth_failed', message: 'nope' });
  });
});
