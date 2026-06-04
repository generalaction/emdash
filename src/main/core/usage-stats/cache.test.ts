import { describe, expect, it, vi } from 'vitest';
import { CACHE_VERSION, reconcileCache, type UsageIndex } from './cache';
import type { ScannedFile, UsageRecord } from './types';

const file = (path: string, mtimeMs: number, size: number): ScannedFile => ({
  path,
  mtimeMs,
  size,
  provider: 'claude',
});
const recordsFor = (path: string): UsageRecord[] => [
  {
    id: path,
    isMessage: true,
    provider: 'claude',
    vendor: 'anthropic',
    ts: 't',
    model: 'claude-opus-4-8',
    cwd: '/x',
    sessionId: 's',
    input: 1,
    output: 1,
    cacheRead: 0,
    cacheWrite: 0,
  },
];

describe('reconcileCache', () => {
  it('parses new files and reuses unchanged ones (by mtime+size)', () => {
    const parse = vi.fn((_text: string, f: ScannedFile) => recordsFor(f.path));
    const readText = (_f: ScannedFile) => 'irrelevant';
    const empty: UsageIndex = { version: CACHE_VERSION, files: {} };

    const scan = [file('/a.jsonl', 1, 10)];
    const first = reconcileCache(empty, scan, readText, parse);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(first.records).toHaveLength(1);

    parse.mockClear();
    const second = reconcileCache(first.index, scan, readText, parse);
    expect(parse).toHaveBeenCalledTimes(0);
    expect(second.records).toHaveLength(1);
  });

  it('re-parses a changed file and drops deleted files', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const readText = () => 'x';
    const first = reconcileCache(
      { version: CACHE_VERSION, files: {} },
      [file('/a.jsonl', 1, 10)],
      readText,
      parse
    );

    parse.mockClear();
    const changed = reconcileCache(first.index, [file('/a.jsonl', 2, 99)], readText, parse);
    expect(parse).toHaveBeenCalledTimes(1);

    const afterDelete = reconcileCache(changed.index, [], readText, parse);
    expect(Object.keys(afterDelete.index.files)).toHaveLength(0);
    expect(afterDelete.records).toHaveLength(0);
  });

  it('does not cache a file whose parse throws, so it retries next run', () => {
    const readText = () => 'x';
    const scan = [file('/bad.jsonl', 1, 10)];

    const throwing = vi.fn(() => {
      throw new Error('partial json');
    });
    const first = reconcileCache({ version: CACHE_VERSION, files: {} }, scan, readText, throwing);
    expect(first.records).toHaveLength(0);
    expect(first.index.files['/bad.jsonl']).toBeUndefined(); // not cached as an empty entry

    // Same mtime+size next run: still re-parsed (not served from a poisoned empty cache).
    const ok = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const second = reconcileCache(first.index, scan, readText, ok);
    expect(ok).toHaveBeenCalledTimes(1);
    expect(second.records).toHaveLength(1);
  });

  it('discards the whole index on version mismatch', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const stale: UsageIndex = {
      version: CACHE_VERSION - 1,
      files: { '/a.jsonl': { mtimeMs: 1, size: 10, records: recordsFor('/a.jsonl') } },
    };
    reconcileCache(stale, [file('/a.jsonl', 1, 10)], () => 'x', parse);
    expect(parse).toHaveBeenCalledTimes(1); // not reused despite matching mtime+size
  });
});
