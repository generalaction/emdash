import { describe, expect, it } from 'vitest';

import { detectMentionTrigger, filterByPath, getDisplayName } from './useFileMentions';

describe('detectMentionTrigger', () => {
  it('activates when @ is at start of input', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({
      active: true,
      query: '',
      startIndex: 0,
    });

    expect(detectMentionTrigger('@src/ma', 7)).toEqual({
      active: true,
      query: 'src/ma',
      startIndex: 0,
    });
  });

  it('activates when @ is preceded by whitespace and preserves that whitespace', () => {
    // hello␠@s
    expect(detectMentionTrigger('hello @s', 8)).toEqual({
      active: true,
      query: 's',
      startIndex: 6,
    });
  });

  it('does not activate when @ is mid-word', () => {
    expect(detectMentionTrigger('email@test.com', 14)).toEqual({ active: false });
  });
});

describe('filterByPath', () => {
  const items = [
    { path: 'README.md', type: 'file' as const },
    { path: 'src', type: 'dir' as const },
    { path: 'src/main', type: 'dir' as const },
    { path: 'src/main/index.ts', type: 'file' as const },
    { path: 'src/main/utils.ts', type: 'file' as const },
    { path: 'src/renderer', type: 'dir' as const },
    { path: 'src/renderer/App.tsx', type: 'file' as const },
    { path: 'package.json', type: 'file' as const },
    { path: 'docs', type: 'dir' as const },
    { path: 'docs/README.md', type: 'file' as const },
  ];

  it('returns only top-level items for empty query', () => {
    const result = filterByPath(items, '');
    expect(result.map((it) => it.path).sort()).toEqual(
      ['README.md', 'docs', 'package.json', 'src'].sort()
    );
  });

  it('filters top-level items by prefix when no directory separator is present', () => {
    const result = filterByPath(items, 's');
    expect(result.map((it) => it.path)).toEqual(['src']);
  });

  it('shows direct children for a directory query ending with "/"', () => {
    const result = filterByPath(items, 'src/');
    expect(result.map((it) => it.path).sort()).toEqual(['src/main', 'src/renderer'].sort());
  });

  it('filters direct children within a directory by name prefix', () => {
    const result = filterByPath(items, 'src/ma');
    expect(result.map((it) => it.path)).toEqual(['src/main']);
  });

  it('shows direct children for nested directories', () => {
    const result = filterByPath(items, 'src/main/');
    expect(result.map((it) => it.path).sort()).toEqual(
      ['src/main/index.ts', 'src/main/utils.ts'].sort()
    );
  });

  it('normalizes backslashes in the query', () => {
    const result = filterByPath(items, 'src\\ma');
    expect(result.map((it) => it.path)).toEqual(['src/main']);
  });
});

describe('getDisplayName', () => {
  it('returns relative name within the current directory prefix', () => {
    expect(getDisplayName({ path: 'src/main', type: 'dir' }, 'src/ma')).toBe('main');
    expect(getDisplayName({ path: 'src/main/index.ts', type: 'file' }, 'src/main/')).toBe(
      'index.ts'
    );
  });

  it('falls back to full path when there is no directory prefix', () => {
    expect(getDisplayName({ path: 'src/main', type: 'dir' }, '')).toBe('src/main');
    expect(getDisplayName({ path: 'README.md', type: 'file' }, 're')).toBe('README.md');
  });
});
