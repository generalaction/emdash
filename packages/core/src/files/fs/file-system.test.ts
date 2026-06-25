import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileSystem } from './file-system';

const roots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-core-fs-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('FileSystem', () => {
  it('reads text and bytes with truncation metadata', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'file.txt'), 'hello world', 'utf8');
    const fs = new FileSystem(root);

    const text = await fs.readText('file.txt', { maxBytes: 5 });
    expect(text.success).toBe(true);
    if (!text.success) return;
    expect(text.data).toEqual({ content: 'hello', truncated: true, totalSize: 11 });

    const bytes = await fs.readBytes('file.txt', { maxBytes: 20 });
    expect(bytes.success).toBe(true);
    if (!bytes.success) return;
    expect(Buffer.from(bytes.data.bytes).toString('utf8')).toBe('hello world');
    expect(bytes.data.truncated).toBe(false);
  });

  it('writes files inside the root and creates parent directories', async () => {
    const root = await makeRoot();
    const fs = new FileSystem(root);

    const written = await fs.writeText('src/index.ts', 'export {};');
    expect(written.success).toBe(true);
    if (!written.success) return;
    expect(written.data.bytesWritten).toBe(Buffer.byteLength('export {};'));
    await expect(readFile(path.join(root, 'src/index.ts'), 'utf8')).resolves.toBe('export {};');
  });

  it('rejects absolute paths and parent traversal', async () => {
    const root = await makeRoot();
    const fs = new FileSystem(root);

    await expect(fs.readText('/tmp/file.txt')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    await expect(fs.writeText('../file.txt', 'x')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });

  it('stats, checks existence, copies, and removes files', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/a.txt'), 'a', 'utf8');
    const fs = new FileSystem(root);

    const stat = await fs.stat('src/a.txt');
    expect(stat.success).toBe(true);
    if (!stat.success) return;
    expect(stat.data).toMatchObject({ path: 'src/a.txt', type: 'file', size: 1 });

    await expect(fs.exists('src/a.txt')).resolves.toEqual({ success: true, data: true });
    await expect(fs.copyFile('src/a.txt', 'dest/b.txt')).resolves.toEqual({
      success: true,
      data: undefined,
    });
    await expect(readFile(path.join(root, 'dest/b.txt'), 'utf8')).resolves.toBe('a');
    await expect(fs.remove('src/a.txt')).resolves.toEqual({ success: true, data: undefined });
    await expect(fs.exists('src/a.txt')).resolves.toEqual({ success: true, data: false });
  });

  it('does not remove the root through an empty path', async () => {
    const root = await makeRoot();
    const fs = new FileSystem(root);

    await expect(fs.remove('')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    await expect(fs.exists('')).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
  });
});
