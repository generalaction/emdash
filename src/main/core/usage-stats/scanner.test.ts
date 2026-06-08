import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDir } from './scanner';

describe('scanDir', () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-scan-'));

  it('recursively finds .jsonl files with mtime and size, tagged by provider', () => {
    mkdirSync(join(root, 'a', 'b'), { recursive: true });
    writeFileSync(join(root, 'a', 'top.jsonl'), 'x');
    writeFileSync(join(root, 'a', 'b', 'deep.jsonl'), 'xy');
    writeFileSync(join(root, 'a', 'ignore.txt'), 'no');

    const files = scanDir(root, 'claude');
    const names = files.map((f) => f.path).sort();
    expect(names.some((p) => p.endsWith('top.jsonl'))).toBe(true);
    expect(names.some((p) => p.endsWith('deep.jsonl'))).toBe(true);
    expect(names.some((p) => p.endsWith('.txt'))).toBe(false);
    const deep = files.find((f) => f.path.endsWith('deep.jsonl'));
    expect(deep?.provider).toBe('claude');
    expect(deep?.size).toBe(2);
    expect(deep?.mtimeMs).toBeGreaterThan(0);
  });

  it('returns [] for a missing directory without throwing', () => {
    expect(scanDir(join(root, 'does-not-exist'), 'codex')).toEqual([]);
  });
});
