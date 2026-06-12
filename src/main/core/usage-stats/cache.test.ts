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
    const result = reconcileCache(stale, [file('/a.jsonl', 1, 10)], () => 'x', parse);
    expect(parse).toHaveBeenCalledTimes(1); // not reused despite matching mtime+size
    expect(result.changed).toBe(true); // version mismatch always marks index dirty
  });
});

describe('reconcileCache – changed flag', () => {
  it('changed is true on first run with a new file', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const empty: UsageIndex = { version: CACHE_VERSION, files: {} };
    const result = reconcileCache(empty, [file('/a.jsonl', 1, 10)], () => 'x', parse);
    expect(result.changed).toBe(true);
  });

  it('changed is false when re-reconciling the same scan against the produced index', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const empty: UsageIndex = { version: CACHE_VERSION, files: {} };
    const scan = [file('/a.jsonl', 1, 10)];
    const first = reconcileCache(empty, scan, () => 'x', parse);
    expect(first.changed).toBe(true);

    parse.mockClear();
    const second = reconcileCache(first.index, scan, () => 'x', parse);
    expect(parse).toHaveBeenCalledTimes(0);
    expect(second.changed).toBe(false); // steady-state: no rewrite needed
  });

  it('changed is true when a file is deleted', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const scan = [file('/a.jsonl', 1, 10)];
    const first = reconcileCache({ version: CACHE_VERSION, files: {} }, scan, () => 'x', parse);
    const afterDelete = reconcileCache(first.index, [], () => 'x', parse);
    expect(afterDelete.changed).toBe(true);
  });

  it('changed is true on version mismatch even when mtime+size match', () => {
    const parse = vi.fn((_t: string, f: ScannedFile) => recordsFor(f.path));
    const stale: UsageIndex = {
      version: CACHE_VERSION - 1,
      files: { '/a.jsonl': { mtimeMs: 1, size: 10, records: recordsFor('/a.jsonl') } },
    };
    const result = reconcileCache(stale, [file('/a.jsonl', 1, 10)], () => 'x', parse);
    expect(result.changed).toBe(true);
  });

  it('changed is false when a file whose parse throws was never cached and scan is identical', () => {
    const scan = [file('/bad.jsonl', 1, 10)];
    const throwing = vi.fn(() => {
      throw new Error('partial json');
    });
    const first = reconcileCache({ version: CACHE_VERSION, files: {} }, scan, () => 'x', throwing);
    // parse threw, so nothing was cached — index is the same as before (empty)
    expect(first.changed).toBe(false);

    // second run against the same prev (which never cached this file) also unchanged
    const second = reconcileCache(first.index, scan, () => 'x', throwing);
    expect(second.changed).toBe(false);
  });

  it('(spread guard) 200_000 cached records reconcile without throwing', () => {
    const bigRecords: UsageRecord[] = [];
    for (let i = 0; i < 200_000; i++) {
      bigRecords.push({
        id: `r${i}`,
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
      });
    }
    const prev: UsageIndex = {
      version: CACHE_VERSION,
      files: { '/big.jsonl': { mtimeMs: 1, size: 10, records: bigRecords } },
    };
    const result = reconcileCache(prev, [file('/big.jsonl', 1, 10)], () => '', vi.fn());
    expect(result.records).toHaveLength(200_000);
    expect(result.changed).toBe(false);
  });
});
