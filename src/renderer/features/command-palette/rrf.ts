import type { SearchItem } from '@shared/search';

type Rankable = { kind: string; id: string };

/**
 * Reciprocal Rank Fusion merges multiple ranked lists into one.
 * Uses rank position rather than raw score, so lists with incompatible
 * scoring systems (e.g. BM25 and fuzzy match) can be combined safely.
 * k=60 is the standard constant that dampens top-rank influence.
 */
export function rrf<T extends Rankable>(lists: T[][], k = 60): T[] {
  const scores = new Map<string, number>();
  const items = new Map<string, T>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const key = `${item.kind}:${item.id}`;
      scores.set(key, (scores.get(key) ?? 0) + 1 / (k + rank + 1));
      if (!items.has(key)) items.set(key, item);
    });
  }

  return [...items.values()].sort(
    (a, b) => (scores.get(`${b.kind}:${b.id}`) ?? 0) - (scores.get(`${a.kind}:${a.id}`) ?? 0)
  );
}

/**
 * Re-ranks FTS5 results by boosting items belonging to the active project
 * before they enter RRF. Applied to List A (DB results) only — actions
 * (List B) are already ordered by context relevance.
 */
export function applyContextAffinity(
  items: SearchItem[],
  context: { projectId?: string }
): SearchItem[] {
  return [...items].sort((a, b) => {
    const boost = (x: SearchItem) =>
      x.projectId === context.projectId && context.projectId != null ? 1 : 0;
    const diff = boost(b) - boost(a);
    // BM25: lower (more negative) is better
    return diff !== 0 ? diff : a.score - b.score;
  });
}
