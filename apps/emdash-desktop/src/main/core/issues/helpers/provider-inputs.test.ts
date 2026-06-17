import { describe, expect, it } from 'vitest';
import {
  clampIssueLimit,
  normalizeSearchTerm,
  requireProjectPath,
  requireRepositoryUrl,
} from './provider-inputs';

describe('clampIssueLimit', () => {
  it('uses fallback and clamps bounds', () => {
    expect(clampIssueLimit(undefined, 50, 100)).toBe(50);
    expect(clampIssueLimit(0, 50, 100)).toBe(1);
    expect(clampIssueLimit(120, 50, 100)).toBe(100);
  });
});

describe('requireProjectPath', () => {
  it('returns trimmed project path', () => {
    expect(requireProjectPath('  /tmp/repo  ')).toBe('/tmp/repo');
    expect(requireProjectPath('')).toBeNull();
  });
});

describe('requireRepositoryUrl', () => {
  it('returns trimmed repository URL', () => {
    expect(requireRepositoryUrl('  https://gitlab.example.com/acme/repo  ')).toBe(
      'https://gitlab.example.com/acme/repo'
    );
    expect(requireRepositoryUrl('')).toBeNull();
  });
});

describe('normalizeSearchTerm', () => {
  it('trims and normalizes values', () => {
    expect(normalizeSearchTerm('  abc  ')).toBe('abc');
    expect(normalizeSearchTerm('')).toBe('');
  });
});
