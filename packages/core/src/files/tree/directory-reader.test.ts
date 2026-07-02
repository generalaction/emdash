import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createRootPathPolicy } from '../path-policy';
import { createTreeDirectoryReader } from './directory-reader';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('TreeDirectoryReader', () => {
  it('reads complete directory entries by default', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });
    await writeFile(path.join(root, '.env'), 'env');

    const reader = createReader(root);
    const read = await reader.readChildren(root, { sort: true });

    expect(read.success).toBe(true);
    if (!read.success || read.data.kind !== 'entries') return;
    expect(read.data.entries.map((entry) => entry.name)).toEqual(['node_modules', 'src', '.env']);
  });

  it('applies caller-owned exclusions when supplied', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules'), { recursive: true });
    await mkdir(path.join(root, 'src'), { recursive: true });

    const reader = createReader(root);
    const read = await reader.readChildren(root, {
      exclude: (absPath) => absPath.includes('node_modules'),
      sort: true,
    });

    expect(read.success).toBe(true);
    if (!read.success || read.data.kind !== 'entries') return;
    expect(read.data.entries.map((entry) => entry.name)).toEqual(['src']);
  });

  it('includes symlink entries and can soft-fail unreadable paths', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'target.txt'), 'target');
    try {
      await symlink('target.txt', path.join(root, 'link.txt'), 'file');
    } catch {
      // Some environments disallow symlink creation.
      return;
    }

    const reader = createReader(root);
    const read = await reader.readChildren(root, { sort: true });
    const missing = await reader.readChildren(path.join(root, 'missing'), { softFail: true });

    expect(read.success).toBe(true);
    if (read.success && read.data.kind === 'entries') {
      expect(read.data.entries.map((entry) => entry.name)).toEqual(['link.txt', 'target.txt']);
      expect(read.data.entries.find((entry) => entry.name === 'link.txt')).toMatchObject({
        type: 'symlink',
        symlink: { targetType: 'file', broken: false },
      });
    }
    expect(missing).toEqual({ success: true, data: { kind: 'unreadable' } });
  });
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-directory-reader-'));
  roots.push(root);
  return root;
}

function createReader(rootPath: string) {
  const policy = createRootPathPolicy(rootPath);
  if (!policy.success) throw new Error(policy.error.message);
  return createTreeDirectoryReader(policy.data);
}
