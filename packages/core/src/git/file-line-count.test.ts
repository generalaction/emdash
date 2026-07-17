import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countFileLines } from './file-line-count';

async function withTempFile(content: string, run: (filePath: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(tmpdir(), 'emdash-file-line-count-'));
  try {
    const filePath = path.join(dir, 'file.txt');
    await writeFile(filePath, content, 'utf8');
    await run(filePath);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
}

describe('countFileLines', () => {
  it('counts an empty file as zero lines', async () => {
    await withTempFile('', async (filePath) => {
      await expect(countFileLines(filePath, { maxBytes: 512 })).resolves.toEqual({
        lines: 0,
        truncated: false,
        totalSize: 0,
      });
    });
  });

  it('counts a single line without a trailing newline', async () => {
    await withTempFile('hello', async (filePath) => {
      await expect(countFileLines(filePath, { maxBytes: 512 })).resolves.toEqual({
        lines: 1,
        truncated: false,
        totalSize: 5,
      });
    });
  });

  it('counts lines with trailing newlines', async () => {
    await withTempFile('one\ntwo\n', async (filePath) => {
      await expect(countFileLines(filePath, { maxBytes: 512 })).resolves.toEqual({
        lines: 2,
        truncated: false,
        totalSize: 8,
      });
    });
  });

  it('counts crlf line endings', async () => {
    await withTempFile('one\r\ntwo', async (filePath) => {
      await expect(countFileLines(filePath, { maxBytes: 512 })).resolves.toEqual({
        lines: 2,
        truncated: false,
        totalSize: 8,
      });
    });
  });

  it('marks files as truncated when they exceed the byte cap', async () => {
    await withTempFile('one\ntwo\nthree\n', async (filePath) => {
      await expect(countFileLines(filePath, { maxBytes: 4 })).resolves.toEqual({
        lines: 1,
        truncated: true,
        totalSize: 14,
      });
    });
  });
});
