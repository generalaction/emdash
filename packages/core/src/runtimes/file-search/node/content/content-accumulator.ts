import type { PortableRelativePath } from '@primitives/path/api';
import {
  CONTENT_SEARCH_MAX_TEXT_LENGTH,
  type ContentSearchFileResult,
  type ContentSearchLineMatch,
  type ContentSearchResult,
} from '@runtimes/file-search/api';
import type { ContentSearchContext } from './content-searcher';

const PROGRESS_MATCH_BATCH_SIZE = 50;

/** Bounds and batches the append-only result stream produced by the ripgrep adapter. */
export class ContentSearchAccumulator {
  private readonly files = new Map<PortableRelativePath, ContentSearchLineMatch[]>();
  private readonly progress = new Map<PortableRelativePath, ContentSearchLineMatch[]>();
  private occurrenceCount = 0;
  private pendingOccurrenceCount = 0;
  private textLength = 0;

  constructor(private readonly context: ContentSearchContext) {}

  add(path: PortableRelativePath, match: ContentSearchLineMatch, limit: number): boolean {
    const remaining = limit - this.occurrenceCount;
    if (remaining <= 0) return true;

    const existing = findLineMatch(this.files, path, match.lineNumber);
    if (!existing && this.textLength + match.text.length > CONTENT_SEARCH_MAX_TEXT_LENGTH) {
      return true;
    }

    const ranges = match.ranges.slice(0, remaining);
    const lineMatch: ContentSearchLineMatch = {
      lineNumber: match.lineNumber,
      text: match.text,
      ranges,
    };
    appendLineMatch(this.files, path, lineMatch);
    appendLineMatch(this.progress, path, { ...lineMatch, ranges: [...lineMatch.ranges] });
    if (!existing) this.textLength += match.text.length;
    this.occurrenceCount += ranges.length;
    this.pendingOccurrenceCount += ranges.length;
    if (this.pendingOccurrenceCount >= PROGRESS_MATCH_BATCH_SIZE) this.flushProgress();
    return this.occurrenceCount >= limit;
  }

  result(limitHit: boolean): ContentSearchResult {
    this.flushProgress();
    return { files: toFileResults(this.files), limitHit };
  }

  private flushProgress(): void {
    if (this.pendingOccurrenceCount === 0 || this.context.signal.aborted) return;
    this.context.onProgress({ files: toFileResults(this.progress) });
    this.progress.clear();
    this.pendingOccurrenceCount = 0;
  }
}

function findLineMatch(
  files: ReadonlyMap<PortableRelativePath, ContentSearchLineMatch[]>,
  path: PortableRelativePath,
  lineNumber: number
): ContentSearchLineMatch | undefined {
  return files.get(path)?.find((candidate) => candidate.lineNumber === lineNumber);
}

function appendLineMatch(
  files: Map<PortableRelativePath, ContentSearchLineMatch[]>,
  path: PortableRelativePath,
  match: ContentSearchLineMatch
): void {
  const matches = files.get(path);
  if (!matches) {
    files.set(path, [match]);
    return;
  }
  const existing = matches.find((candidate) => candidate.lineNumber === match.lineNumber);
  if (existing) existing.ranges.push(...match.ranges);
  else matches.push(match);
}

function toFileResults(
  files: ReadonlyMap<PortableRelativePath, ContentSearchLineMatch[]>
): ContentSearchFileResult[] {
  return [...files].map(([path, matches]) => ({
    path,
    matches: matches.map((match) => ({ ...match, ranges: [...match.ranges] })),
  }));
}
