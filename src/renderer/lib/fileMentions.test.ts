import { describe, expect, it } from 'vitest';

import {
  getMentionBasePath,
  getMentionKeyAction,
  normalizeMentionQuery,
  shouldCloseMentionDropdown,
} from './fileMentions';

describe('normalizeMentionQuery', () => {
  it('replaces backslashes with forward slashes', () => {
    expect(normalizeMentionQuery('src\\main')).toBe('src/main');
  });
});

describe('getMentionBasePath', () => {
  it('returns empty base when query is empty', () => {
    expect(getMentionBasePath('src/main', '')).toBe('');
  });

  it('matches case-insensitively and normalizes query slashes', () => {
    expect(getMentionBasePath('src/main', 'SRC\\MA')).toBe('src/ma');
  });
});

describe('getMentionKeyAction', () => {
  it('returns none when inactive', () => {
    expect(getMentionKeyAction({ active: false, hasItems: true, key: 'Enter' })).toBe('none');
  });

  it('always allows escape to close', () => {
    expect(getMentionKeyAction({ active: true, hasItems: false, key: 'Escape' })).toBe('close');
  });

  it('ignores selection keys when there are no items', () => {
    expect(getMentionKeyAction({ active: true, hasItems: false, key: 'ArrowDown' })).toBe('none');
    expect(getMentionKeyAction({ active: true, hasItems: false, key: 'Enter' })).toBe('none');
  });

  it('maps navigation and selection keys when items exist', () => {
    expect(getMentionKeyAction({ active: true, hasItems: true, key: 'ArrowDown' })).toBe('next');
    expect(getMentionKeyAction({ active: true, hasItems: true, key: 'ArrowUp' })).toBe('prev');
    expect(
      getMentionKeyAction({ active: true, hasItems: true, key: 'Enter', shiftKey: false })
    ).toBe('select');
    expect(
      getMentionKeyAction({ active: true, hasItems: true, key: 'Enter', shiftKey: true })
    ).toBe('none');
    expect(getMentionKeyAction({ active: true, hasItems: true, key: 'Tab' })).toBe('select');
  });
});

describe('shouldCloseMentionDropdown', () => {
  it('returns false for null targets', () => {
    expect(shouldCloseMentionDropdown({ target: null, textareaEl: null, dropdownEl: null })).toBe(
      false
    );
  });

  it('returns false when target is inside textarea or dropdown', () => {
    const target = {} as Node;
    const textareaEl = { contains: (node: Node) => node === target };
    const dropdownEl = { contains: (node: Node) => node === target };

    expect(shouldCloseMentionDropdown({ target, textareaEl, dropdownEl: null })).toBe(false);
    expect(shouldCloseMentionDropdown({ target, textareaEl: null, dropdownEl })).toBe(false);
  });

  it('returns true when target is outside both textarea and dropdown', () => {
    const target = {} as Node;
    const textareaEl = { contains: () => false };
    const dropdownEl = { contains: () => false };

    expect(shouldCloseMentionDropdown({ target, textareaEl, dropdownEl })).toBe(true);
  });
});
