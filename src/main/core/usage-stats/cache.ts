import { readFileSync, writeFileSync } from 'node:fs';
import type { ScannedFile, UsageRecord } from './types';

export const CACHE_VERSION = 1;

export type CachedFile = { mtimeMs: number; size: number; records: UsageRecord[] };
export type UsageIndex = { version: number; files: Record<string, CachedFile> };

export type ReadText = (file: ScannedFile) => string;
export type ParseFn = (text: string, file: ScannedFile) => UsageRecord[];

/** Returns the next index plus the flattened records across all current files. */
export function reconcileCache(
  prev: UsageIndex,
  scan: ScannedFile[],
  readText: ReadText,
  parse: ParseFn
): { index: UsageIndex; records: UsageRecord[] } {
  const usable = prev.version === CACHE_VERSION ? prev.files : {};
  const nextFiles: Record<string, CachedFile> = {};
  const records: UsageRecord[] = [];

  for (const file of scan) {
    const cached = usable[file.path];
    if (cached && cached.mtimeMs === file.mtimeMs && cached.size === file.size) {
      nextFiles[file.path] = cached;
      records.push(...cached.records);
      continue;
    }
    let parsed: UsageRecord[] = [];
    try {
      parsed = parse(readText(file), file);
    } catch {
      parsed = []; // unreadable file — skip its records, keep going
    }
    nextFiles[file.path] = { mtimeMs: file.mtimeMs, size: file.size, records: parsed };
    records.push(...parsed);
  }

  return { index: { version: CACHE_VERSION, files: nextFiles }, records };
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
