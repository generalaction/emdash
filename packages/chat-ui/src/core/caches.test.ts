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

// ── parseBlocksStreaming ───────────────────────────────────────────────────────

describe('createChatCaches().parseBlocksStreaming', () => {
  it('returns empty array for empty text', () => {
    const caches = createChatCaches();
    expect(caches.parseBlocksStreaming('m1', '')).toEqual([]);
    expect(caches.parseBlocksStreaming('m1', '   ')).toEqual([]);
  });

  it('parses a simple growing paragraph without a boundary', () => {
    const caches = createChatCaches();
    const blocks = caches.parseBlocksStreaming('m1', 'Hello world');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kind).toBe('prose');
  });

  it('stable prefix blocks keep object identity across appends', () => {
    const caches = createChatCaches();

    // First chunk: one complete paragraph + start of a second (no blank line yet).
    const text1 = 'Para one.\n\nPara two is grow';
    const blocks1 = caches.parseBlocksStreaming('m1', text1);
    expect(blocks1).toHaveLength(2);

    // Second chunk: para two keeps growing (no new boundary).
    const text2 = 'Para one.\n\nPara two is growing more';
    const blocks2 = caches.parseBlocksStreaming('m1', text2);
    expect(blocks2).toHaveLength(2);

    // The first block (settled prefix) must be the same object reference.
    expect(blocks2[0]).toBe(blocks1[0]);
    // The second block (growing tail) is re-parsed each time — different object.
    expect(blocks2[1]).not.toBe(blocks1[1]);
  });

  it('advances the stable prefix when a new blank line appears', () => {
    const caches = createChatCaches();

    const text1 = 'Para one.\n\nPara two is grow';
    const blocks1 = caches.parseBlocksStreaming('m1', text1);
    const firstBlock = blocks1[0];

    // New blank line after para two finalises it into the stable prefix.
    const text2 = 'Para one.\n\nPara two is complete.\n\nPara three start';
    const blocks2 = caches.parseBlocksStreaming('m1', text2);
    expect(blocks2).toHaveLength(3);

    // The first block is still the same object.
    expect(blocks2[0]).toBe(firstBlock);
    // The second block is now a stable object (it was finalised this chunk).
    expect(blocks2[1].kind).toBe('prose');
  });

  it('assigns sequential IDs across settled chunks', () => {
    const caches = createChatCaches();

    const finalText = 'Para one.\n\nPara two.\n\nPara three.';
    const blocks = caches.parseBlocksStreaming('m1', finalText);
    expect(blocks.map((b) => b.id)).toEqual(['m1#0', 'm1#1', 'm1#2']);
  });

  it('does not treat blank lines inside a code fence as a boundary', () => {
    const caches = createChatCaches();

    // Code fence is open — blank line inside should not become a boundary.
    const text = 'Intro.\n\n```js\nconst x = 1;\n\nconst y = 2;\n```\n\nOutro.';
    const blocks = caches.parseBlocksStreaming('m1', text);

    // Should have: intro prose, code block, outro prose.
    expect(blocks.some((b) => b.kind === 'code')).toBe(true);
  });

  it('falls back to full reparse on non-append text (edit/replay)', () => {
    const caches = createChatCaches();

    const text1 = 'Para one.\n\nPara two.\n\n';
    const blocks1 = caches.parseBlocksStreaming('m1', text1);
    const firstBlock = blocks1[0];

    // Simulate an edit — the new text does NOT start with the stable prefix.
    const textEdited = 'Completely different content.\n\n';
    const blocks2 = caches.parseBlocksStreaming('m1', textEdited);

    // IDs restart from 0.
    expect(blocks2[0].id).toBe('m1#0');
    // Object identity is reset — different from the original first block.
    expect(blocks2[0]).not.toBe(firstBlock);
  });

  it('parseBlocks (non-streaming) clears the streaming record', () => {
    const caches = createChatCaches();

    const text = 'Para one.\n\nPara two grow';
    const streaming = caches.parseBlocksStreaming('m1', text);
    const streamBlock = streaming[0];

    // Freeze — call the normal parseBlocks path.
    const frozen = caches.parseBlocks('m1', 'Para one.\n\nPara two complete.');
    expect(frozen).toHaveLength(2);

    // Next streaming call starts fresh (record was cleared by parseBlocks).
    const restarted = caches.parseBlocksStreaming('m1', 'New stream start');
    expect(restarted[0].id).toBe('m1#0');
    // Not the same object as before the freeze.
    expect(restarted[0]).not.toBe(streamBlock);
  });

  it('evictBlocks clears the streaming record as well', () => {
    const caches = createChatCaches();
    caches.parseBlocksStreaming('m1', 'Para one.\n\n');
    caches.evictBlocks('m1');
    // After evict, streaming restarts with counter 0.
    const blocks = caches.parseBlocksStreaming('m1', 'Fresh start');
    expect(blocks[0].id).toBe('m1#0');
  });

  it('clear() removes streaming records', () => {
    const caches = createChatCaches();
    caches.parseBlocksStreaming('m1', 'Para one.\n\nPara two grow');
    caches.clear();
    const blocks = caches.parseBlocksStreaming('m1', 'After clear');
    expect(blocks[0].id).toBe('m1#0');
  });
});
