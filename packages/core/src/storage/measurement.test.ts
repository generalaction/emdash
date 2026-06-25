import { link, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { measureTaskStorage } from './measurement';

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(path.join(os.tmpdir(), 'emdash-storage-'));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

describe('measureTaskStorage', () => {
  it('measures total directory usage', async () => {
    const root = path.join(tmpDir, 'task');
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, 'src', 'index.ts'), 'source');

    const usage = await measureTaskStorage(root);

    expect(usage.exists).toBe(true);
    expect(usage.isDirectory).toBe(true);
    expect(usage.apparentBytes).toBeGreaterThan(0);
    expect(usage.reclaimableBytes).toBeGreaterThan(0);
  });

  it('does not count externally linked file contents as reclaimable', async () => {
    const root = path.join(tmpDir, 'task');
    const store = path.join(tmpDir, 'store');
    const linkedFile = path.join(root, 'node_modules', 'pkg', 'index.js');
    const storeFile = path.join(store, 'index.js');
    await mkdir(path.dirname(linkedFile), { recursive: true });
    await mkdir(store, { recursive: true });
    await writeFile(storeFile, 'x'.repeat(128 * 1024));
    await link(storeFile, linkedFile);

    const usage = await measureTaskStorage(root);

    expect(usage.apparentBytes).toBeGreaterThan(128 * 1024);
    expect(usage.reclaimableBytes).toBeLessThan(usage.apparentBytes);
  });

  it('reports missing paths without throwing', async () => {
    const usage = await measureTaskStorage(path.join(tmpDir, 'missing'));

    expect(usage.exists).toBe(false);
    expect(usage.errors[0]?.type).toBe('not-found');
  });
});
