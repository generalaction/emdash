import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isFileNotFoundError } from '../errors';
import { FileSystem } from './file-system';

let tmpDir: string;
const fileSystem = new FileSystem();

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-measure-usage-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('FileSystem.measureUsage', () => {
  it('measures total directory usage', async () => {
    const root = path.join(tmpDir, 'task');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.ts'), 'source');

    const usage = await fileSystem.measureUsage(root);

    expect(usage.success).toBe(true);
    if (!usage.success) return;
    expect(usage.data.type).toBe('directory');
    expect(usage.data.apparentBytes).toBeGreaterThan(0);
    expect(usage.data.diskBytes).toBeGreaterThan(0);
    expect(usage.data.exclusiveDiskBytes).toBeGreaterThan(0);
    expect(usage.data.errors).toEqual([]);
  });

  it('measures a single file', async () => {
    const filePath = path.join(tmpDir, 'file.txt');
    await writeFile(filePath, 'content');

    const usage = await fileSystem.measureUsage(filePath);

    expect(usage.success).toBe(true);
    if (!usage.success) return;
    expect(usage.data.type).toBe('file');
    expect(usage.data.apparentBytes).toBe('content'.length);
  });

  it('does not count externally linked file contents as exclusive', async () => {
    const root = path.join(tmpDir, 'task');
    const store = path.join(tmpDir, 'store');
    const linkedFile = path.join(root, 'node_modules', 'pkg', 'index.js');
    const storeFile = path.join(store, 'index.js');
    await mkdir(path.dirname(linkedFile), { recursive: true });
    await mkdir(store, { recursive: true });
    await writeFile(storeFile, 'x'.repeat(128 * 1024));
    await link(storeFile, linkedFile);

    const usage = await fileSystem.measureUsage(root);

    expect(usage.success).toBe(true);
    if (!usage.success) return;
    expect(usage.data.apparentBytes).toBeGreaterThan(128 * 1024);
    expect(usage.data.diskBytes).toBeGreaterThan(usage.data.exclusiveDiskBytes);
    expect(usage.data.exclusiveDiskBytes).toBeLessThan(usage.data.apparentBytes);
  });

  it('counts internally hardlinked files once and as exclusive', async () => {
    const root = path.join(tmpDir, 'task');
    const first = path.join(root, 'a.bin');
    const second = path.join(root, 'b.bin');
    await mkdir(root, { recursive: true });
    await writeFile(first, 'x'.repeat(64 * 1024));
    await link(first, second);

    const usage = await fileSystem.measureUsage(root);

    expect(usage.success).toBe(true);
    if (!usage.success) return;
    expect(usage.data.exclusiveDiskBytes).toBe(usage.data.diskBytes);
    expect(usage.data.apparentBytes).toBeGreaterThan(usage.data.diskBytes);
  });

  it('returns a not-found error for missing paths', async () => {
    const usage = await fileSystem.measureUsage(path.join(tmpDir, 'missing'));

    expect(usage.success).toBe(false);
    if (usage.success) return;
    expect(isFileNotFoundError(usage.error)).toBe(true);
  });
});
