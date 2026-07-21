import type {
  ContentSearchFileResult,
  ContentSearchRange,
} from '@emdash/core/runtimes/file-search/api';

export type HighlightSegment = Readonly<{
  text: string;
  highlighted: boolean;
}>;

/** Content-search progress is append-only, grouped into occurrence batches. */
export function mergeContentSearchFiles(
  current: readonly ContentSearchFileResult[],
  incoming: readonly ContentSearchFileResult[]
): ContentSearchFileResult[] {
  const merged = new Map(current.map((file) => [file.path, [...file.matches]]));
  for (const file of incoming) {
    const matches = merged.get(file.path);
    if (matches) matches.push(...file.matches);
    else merged.set(file.path, [...file.matches]);
  }
  return [...merged].map(([path, matches]) => ({ path, matches }));
}

export function countContentSearchOccurrences(files: readonly ContentSearchFileResult[]): number {
  return files.reduce(
    (total, file) =>
      total + file.matches.reduce((fileTotal, match) => fileTotal + match.locations.length, 0),
    0
  );
}

export function highlightSegments(
  text: string,
  ranges: readonly ContentSearchRange[]
): HighlightSegment[] {
  const normalized = ranges
    .map(({ startColumn, endColumn }) => ({
      start: Math.max(0, Math.min(text.length, startColumn - 1)),
      end: Math.max(0, Math.min(text.length, endColumn - 1)),
    }))
    .filter(({ start, end }) => end > start)
    .sort((left, right) => left.start - right.start || left.end - right.end)
    .reduce<Array<{ start: number; end: number }>>((result, range) => {
      const previous = result.at(-1);
      if (previous && range.start <= previous.end) {
        previous.end = Math.max(previous.end, range.end);
      } else {
        result.push(range);
      }
      return result;
    }, []);

  if (normalized.length === 0) return [{ text, highlighted: false }];

  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const range of normalized) {
    if (range.start > cursor) {
      segments.push({ text: text.slice(cursor, range.start), highlighted: false });
    }
    segments.push({ text: text.slice(range.start, range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), highlighted: false });
  return segments;
}
