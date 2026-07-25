import { afterEach, describe, expect, it } from 'vitest';
import {
  collectTextNodeMatches,
  getNextDomMatchIndex,
  getTextNodeAtIndex,
  type DomSearchMatch,
} from '@renderer/lib/find/dom-text-search';

function makeRoot(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe('dom-text-search', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('finds case-insensitive matches within a text node', () => {
    const root = makeRoot('<p>Alpha beta beta gamma</p>');

    expect(collectTextNodeMatches(root, 'BETA')).toEqual<DomSearchMatch[]>([
      { nodeIndex: 0, start: 6, length: 4 },
      { nodeIndex: 0, start: 11, length: 4 },
    ]);
  });

  it('finds matches across multiple text nodes in document order', () => {
    const root = makeRoot('<p>Hello world</p><p>another world here</p>');

    expect(collectTextNodeMatches(root, 'world')).toEqual<DomSearchMatch[]>([
      { nodeIndex: 0, start: 6, length: 5 },
      { nodeIndex: 1, start: 8, length: 5 },
    ]);
  });

  it('resolves the text node at a given index', () => {
    const root = makeRoot('<p>first</p><p>second</p>');

    expect(getTextNodeAtIndex(root, 0)?.textContent).toBe('first');
    expect(getTextNodeAtIndex(root, 1)?.textContent).toBe('second');
    expect(getTextNodeAtIndex(root, 2)).toBeNull();
  });

  it('cycles forward and backward through matches', () => {
    const matches: DomSearchMatch[] = [
      { nodeIndex: 0, start: 0, length: 3 },
      { nodeIndex: 1, start: 2, length: 3 },
      { nodeIndex: 2, start: 4, length: 3 },
    ];

    expect(getNextDomMatchIndex(matches, -1, 'next')).toBe(0);
    expect(getNextDomMatchIndex(matches, -1, 'prev')).toBe(2);
    expect(getNextDomMatchIndex(matches, 0, 'next')).toBe(1);
    expect(getNextDomMatchIndex(matches, 0, 'prev')).toBe(2);
    expect(getNextDomMatchIndex(matches, 2, 'next')).toBe(0);
  });

  it('returns no matches for an empty query', () => {
    const root = makeRoot('<p>hello</p>');
    expect(collectTextNodeMatches(root, '')).toEqual([]);
  });

  describe('stale <mark> from a previous match', () => {
    // Regression coverage for the markdown-preview bug: applying a match
    // wraps it in a <mark>, which splits its text node into up to three
    // (before/matched/after) and shifts every later nodeIndex. Re-running
    // collectTextNodeMatches against that mutated DOM — without first
    // unwrapping the stale <mark> — reports offsets that no longer line up
    // with the real text, which surfaced as "wrong substring highlighted"
    // and a Range.setStart "offset is larger than node's length" crash.
    function wrapInStaleMark(root: HTMLElement, textNode: Text, start: number, length: number) {
      const range = document.createRange();
      range.setStart(textNode, start);
      range.setEnd(textNode, start + length);
      const mark = document.createElement('mark');
      range.surroundContents(mark);
      return mark;
    }

    it('produces misaligned offsets when a stale mark is left in place', () => {
      const root = makeRoot('<p>alpha beta gamma beta delta</p>');
      const firstNode = getTextNodeAtIndex(root, 0)!;

      // Simulate having already applied the first "beta" match (mirrors
      // applyMatch), without clearing it before searching again.
      wrapInStaleMark(root, firstNode, 6, 4);

      const matches = collectTextNodeMatches(root, 'beta');
      // Bug reproduced: the stale <mark> splits "alpha beta gamma beta delta"
      // into three text nodes ("alpha ", "beta", " gamma beta delta"), so the
      // walker now reports the second "beta" at nodeIndex 2 / start 7 — which
      // is meaningless once getTextNodeAtIndex is asked to resolve it against
      // the *current* DOM shape, since a second call after any other DOM
      // change (e.g. clearing the mark) walks fresh nodes with different
      // boundaries. Compare against the correct result below.
      expect(matches).toEqual<DomSearchMatch[]>([
        { nodeIndex: 1, start: 0, length: 4 },
        { nodeIndex: 2, start: 7, length: 4 },
      ]);
    });

    it('finds all matches correctly once the stale mark is unwrapped first', () => {
      const root = makeRoot('<p>alpha beta gamma beta delta</p>');
      const firstNode = getTextNodeAtIndex(root, 0)!;
      const mark = wrapInStaleMark(root, firstNode, 6, 4);

      // Unwrap exactly like clearMark() does: hoist children out, remove the
      // mark, normalize so adjacent text nodes merge back into one.
      const parent = mark.parentNode!;
      while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
      parent.removeChild(mark);
      parent.normalize();

      const matches = collectTextNodeMatches(root, 'beta');
      expect(matches).toEqual<DomSearchMatch[]>([
        { nodeIndex: 0, start: 6, length: 4 },
        { nodeIndex: 0, start: 17, length: 4 },
      ]);
    });
  });
});
