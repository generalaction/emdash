/** @vitest-environment jsdom */

import { describe, expect, it } from 'vitest';
import { createParseCaches } from './caches';
import type { Block } from './markdown/document';
import { blockPlainText } from './markdown/plain-text';

// Block boundaries/soft breaks can change as Markdown arrives; all non-space
// source characters must still survive both streaming and committed parsing.
const compact = (text: string) => text.replace(/\s/g, '');
const content = (blocks: Block[]) => compact(blocks.map(blockPlainText).join(''));

describe('tagged message parse caches', () => {
  for (const step of [1, 7]) {
    it.each([
      ['XML', '<task-notification>\n<summary>Monitor finished</summary>\n</task-notification>'],
      ['mixed prose', 'Before\n\n<div>\nFirst\n\nSecond\n</div>\n\nAfter'],
      ['inline tags', 'Before <widget>inside</widget> after'],
    ])(`preserves %s streamed in ${step}-character chunks`, (_label, source) => {
      const caches = createParseCaches();
      for (let end = step; end < source.length + step; end += step) {
        const partial = source.slice(0, end);
        expect(content(caches.parseBlocksStreaming('message', partial)), partial).toBe(
          compact(partial)
        );
      }
      expect(content(caches.parseBlocks('message', source))).toBe(compact(source));
      expect(caches.settledBlockCount('message')).toBe(0);
    });
  }

  it('invalidates an empty cached body when tagged content arrives', () => {
    const caches = createParseCaches();
    expect(caches.parseBlocks('message', '')).toEqual([]);
    const source = '<summary>\nMonitor finished\n</summary>';
    const blocks = caches.parseBlocks('message', source);
    expect(content(blocks)).toBe(compact(source));
    expect(caches.parseBlocks('message', source)).toBe(blocks);
  });

  it('replaces tagged content with the same message ID on history refresh', () => {
    const caches = createParseCaches();
    caches.parseBlocks('message', '<summary>\nOld\n</summary>');
    const source = '<summary>\nNew\n</summary>';
    expect(content(caches.parseBlocks('message', source))).toBe(compact(source));
  });

  it('does not reuse settled markup after a non-append stream correction', () => {
    const caches = createParseCaches();
    caches.parseBlocksStreaming('message', '<div>Old</div>\n\nTail');
    const source = '<div>Corrected</div>\n\nNew tail';
    expect(content(caches.parseBlocksStreaming('message', source))).toBe(compact(source));
    expect(content(caches.parseBlocks('message', source))).toBe(compact(source));
  });

  it.each(['evict', 'clear'] as const)('preserves tagged text after cache %s', (mode) => {
    const caches = createParseCaches();
    const source = '<summary>\nMonitor finished\n</summary>';
    caches.parseBlocks('message', source);
    if (mode === 'evict') caches.evictBlocks('message');
    else caches.clearAll();
    expect(content(caches.parseBlocks('message', source))).toBe(compact(source));
  });
});
