import { readFileSync, writeFileSync } from 'node:fs';
import type { ScannedFile, UsageRecord } from './types';

// Bump when the parsed UsageRecord shape changes so stale caches re-parse.
// v2: records carry `vendor` for provider-scoped pricing.
export const CACHE_VERSION = 2;

export type CachedFile = { mtimeMs: number; size: number; records: UsageRecord[] };
export type UsageIndex = { version: number; files: Record<string, CachedFile> };

export type ReadText = (file: ScannedFile) => string;
export type ParseFn = (text: string, file: ScannedFile) => UsageRecord[];

/** Returns the next index, the flattened records across all current files, and whether the index changed. */
export function reconcileCache(
  prev: UsageIndex,
  scan: ScannedFile[],
  readText: ReadText,
  parse: ParseFn
): { index: UsageIndex; records: UsageRecord[]; changed: boolean } {
  const usable = prev.version === CACHE_VERSION ? prev.files : {};
  const nextFiles: Record<string, CachedFile> = {};
  const records: UsageRecord[] = [];
  // A re-parse or version reset always dirties the index; a deleted file changes the key count;
  // an added file implies a parse. A thrown parse that was never cached leaves the index unchanged.
  let parsedAny = false;

  for (const file of scan) {
    const cached = usable[file.path];
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
      nextFiles[file.path] = cached;
      // no spread: a single huge file's records would exceed V8's argument limit
      for (const r of cached.records) records.push(r);
      continue;
    }
    let parsed: UsageRecord[];
    try {
      parsed = parse(readText(file), file);
    } catch {
      // Unreadable/partial file (e.g. caught mid-write): skip it entirely rather than caching
      // an empty-record entry, which would match next run's mtime+size and never re-parse.
      continue;
    }
    parsedAny = true;
    nextFiles[file.path] = { mtimeMs: file.mtimeMs, size: file.size, records: parsed };
    for (const r of parsed) records.push(r);
  }

  const changed =
    prev.version !== CACHE_VERSION ||
    parsedAny ||
    Object.keys(nextFiles).length !== Object.keys(usable).length;

  return { index: { version: CACHE_VERSION, files: nextFiles }, records, changed };
}

export function loadIndex(path: string): UsageIndex {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as UsageIndex;
    if (parsed.version === CACHE_VERSION && parsed.files) return parsed;
  } catch {
    // missing or corrupt — start fresh
  }
  return { version: CACHE_VERSION, files: {} };
}

export function saveIndex(path: string, index: UsageIndex): void {
  try {
    writeFileSync(path, JSON.stringify(index));
  } catch {
    // non-fatal: cache is an optimization, not a source of truth
  }
}
