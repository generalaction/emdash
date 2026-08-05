export interface DomSearchMatch {
  nodeIndex: number;
  start: number;
  length: number;
}

/**
 * Collects text-node matches for `query` inside `root`. Matches are limited to
 * a single text node — a query split across inline elements (e.g. by a
 * `<code>` span) is a known v1 limitation.
 */
export function collectTextNodeMatches(root: HTMLElement, query: string): DomSearchMatch[] {
  if (!query) return [];

  const normalizedQuery = query.toLocaleLowerCase();
  if (!normalizedQuery) return [];

  const matches: DomSearchMatch[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  let nodeIndex = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const haystack = text.toLocaleLowerCase();
    let fromIndex = 0;

    while (fromIndex <= haystack.length - normalizedQuery.length) {
      const matchIndex = haystack.indexOf(normalizedQuery, fromIndex);
      if (matchIndex === -1) break;

      matches.push({ nodeIndex, start: matchIndex, length: query.length });
      fromIndex = matchIndex + Math.max(1, normalizedQuery.length);
    }

    nodeIndex += 1;
    node = walker.nextNode();
  }

  return matches;
}

/** Returns the text node at `nodeIndex` within `root`, walking in document order. */
export function getTextNodeAtIndex(root: HTMLElement, nodeIndex: number): Text | null {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let index = 0;
  let node = walker.nextNode();
  while (node) {
    if (index === nodeIndex) return node as Text;
    index += 1;
    node = walker.nextNode();
  }
  return null;
}

export function getNextDomMatchIndex(
  matches: DomSearchMatch[],
  currentIndex: number,
  direction: 'next' | 'prev'
): number {
  if (matches.length === 0) return -1;

  if (currentIndex < 0 || currentIndex >= matches.length) {
    return direction === 'prev' ? matches.length - 1 : 0;
  }

  if (direction === 'prev') {
    return currentIndex === 0 ? matches.length - 1 : currentIndex - 1;
  }

  return currentIndex === matches.length - 1 ? 0 : currentIndex + 1;
}
