/**
 * caches.test.ts — unit tests for createChatCaches().
 *
 * Runs in jsdom because core/caches.ts → parse-blocks.ts →
 * decode-named-character-reference accesses document at module load time.
 *
 * @vitest-environment jsdom
 */

import { describe, expect, it } from 'vitest';
import { createChatCaches } from './caches';

// ── computeDiff memoization ───────────────────────────────────────────────────

describe('createChatCaches().computeDiff', () => {
  it('memoizes identical calls — same reference returned', () => {
    const caches = createChatCaches();
    const a = caches.computeDiff('foo\nbar', 'foo\nbaz');
    const b = caches.computeDiff('foo\nbar', 'foo\nbaz');
    expect(a).toBe(b);
  });

  it('different inputs → different results', () => {
    const caches = createChatCaches();
    const a = caches.computeDiff('x', 'y');
    const b = caches.computeDiff('x', 'z');
    expect(a).not.toBe(b);
  });

  it('clear() evicts diff cache — new call recomputes', () => {
    const caches = createChatCaches();
    const a = caches.computeDiff('a\nb', 'a\nc');
    caches.clear();
    const b = caches.computeDiff('a\nb', 'a\nc');
    // After clear, the reference is different (fresh array).
    expect(a).not.toBe(b);
    // But the content is equal.
    expect(a).toEqual(b);
  });

  it('instances are isolated — different bundles do not share cache', () => {
    const c1 = createChatCaches();
    const c2 = createChatCaches();
    const a = c1.computeDiff('foo\nbar', 'foo\nbaz');
    const b = c2.computeDiff('foo\nbar', 'foo\nbaz');
    // Same value, but different object references.
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});
