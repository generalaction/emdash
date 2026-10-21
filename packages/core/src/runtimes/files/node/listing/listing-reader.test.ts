import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deferred } from '@emdash/shared/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExpandableListingEntry } from '#runtimes/files/api';
import { RootPathPolicy } from '#runtimes/files/node/fs/path-policy';
import { relativePath } from '#runtimes/files/node/testing/paths';
import { ListingReader, type ReadEntry } from './listing-reader';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('ListingReader', () => {
  it('reads metadata concurrently with a bounded number of outstanding reads', async () => {
    const root = await makeRoot();
    await Promise.all(
      Array.from({ length: 80 }, (_, index) => writeFile(path.join(root, `${index}.ts`), ''))
    );
    const reader = new ListingReader(new RootPathPolicy(root));
    const original = reader.readEntry.bind(reader);
    const release = deferred<void>();
    let active = 0;
    let maxActive = 0;
    vi.spyOn(reader, 'readEntry').mockImplementation(async (...args) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await release.promise;
      try {
        return await original(...args);
      } finally {
        active -= 1;
      }
    });
    const listing = reader.readFolder(relativePath(''));
    try {
      await vi.waitFor(() => expect(active).toBeGreaterThan(1));
      expect(active).toBeLessThanOrEqual(8);
    } finally {
      release.resolve();
    }
    const result = await listing;
    expect(result.success && result.data.length).toBe(80);
    expect(maxActive).toBeLessThanOrEqual(8);
  });

  it('lists every child, leaving exclusions to the consumer', async () => {
    const root = await makeRoot();
    await mkdir(path.join(root, 'node_modules'));
    await writeFile(path.join(root, '.hidden'), '');
    await writeFile(path.join(root, 'app.ts'), '', { mode: 0o644 });
    const result = await new ListingReader(new RootPathPolicy(root)).readFolder(relativePath(''));
    expect(names(result)).toEqual(['.hidden', 'app.ts', 'node_modules']);
  });

  it('omits a file removed during enumeration without losing other children', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'gone.ts'), '');
    await writeFile(path.join(root, 'kept.ts'), '');
    const reader = new ListingReader(new RootPathPolicy(root));
    const original = reader.readEntry.bind(reader);
    vi.spyOn(reader, 'readEntry').mockImplementation(async (entry, canonical) => {
      if (entry === 'gone.ts') await rm(path.join(root, 'gone.ts'));
      return original(entry, canonical);
    });
    expect(names(await reader.readFolder(relativePath('')))).toEqual(['kept.ts']);
  });

  it.each(['permission-denied', 'io'] as const)(
    'propagates %s instead of returning a partial folder',
    async (type) => {
      const root = await makeRoot();
      await writeFile(path.join(root, 'blocked.ts'), '');
      const reader = new ListingReader(new RootPathPolicy(root));
      vi.spyOn(reader, 'readEntry').mockResolvedValue({
        success: false,
        error: { type, path: 'blocked.ts', message: 'denied' },
      });
      await expect(reader.readFolder(relativePath(''))).resolves.toMatchObject({
        success: false,
        error: { type },
      });
    }
  );

  it.each(['missing', 'file.txt'])('reports an unreadable folder %s', async (name) => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'file.txt'), '');
    await expect(
      new ListingReader(new RootPathPolicy(root)).readFolder(relativePath(name))
    ).resolves.toMatchObject({
      success: false,
      error: { type: name === 'missing' ? 'not-found' : 'not-a-directory' },
    });
  });

  it('returns an empty folder as a successful empty listing', async () => {
    const root = await makeRoot();
    await expect(
      new ListingReader(new RootPathPolicy(root)).readFolder(relativePath(''))
    ).resolves.toEqual({ success: true, data: [] });
  });

  it('describes link targets, including links that leave the root', async () => {
    const root = await makeRoot();
    const outside = await makeRoot();
    await mkdir(path.join(root, 'z-directory'));
    await mkdir(path.join(outside, 'nested'));
    await writeFile(path.join(outside, 'outside.txt'), 'outside');
    await writeFile(path.join(outside, 'nested', 'child.txt'), 'child');
    try {
      await symlink('z-directory', path.join(root, 'linked-directory'), 'dir');
      await symlink(path.join(outside, 'nested'), path.join(root, 'outside-directory'), 'dir');
      await symlink(path.join(outside, 'outside.txt'), path.join(root, 'outside-file'), 'file');
      await symlink('missing', path.join(root, 'missing-link'), 'file');
    } catch {
      return;
    }

    const reader = new ListingReader(new RootPathPolicy(root));
    const result = await reader.readFolder(relativePath(''));
    const entry = (name: string) =>
      result.success ? result.data.find((child) => child.name === name)?.entry : undefined;
    expect(entry('linked-directory')).toEqual({
      kind: 'symlink',
      symlinkTarget: 'z-directory',
      symlinkTargetKind: 'directory',
      symlinkTargetOutsideRoot: false,
    });
    expect(entry('outside-file')).toMatchObject({
      symlinkTargetKind: 'file',
      symlinkTargetOutsideRoot: true,
    });
    expect(entry('missing-link')).toMatchObject({ symlinkTargetKind: 'missing' });
    expect(isExpandableListingEntry(entry('outside-directory')!)).toBe(true);

    expect(names(await reader.readFolder(relativePath('outside-directory')))).toEqual([
      'child.txt',
    ]);
  });

  it('reads one entry with its size and modification time', async () => {
    const root = await makeRoot();
    await writeFile(path.join(root, 'notes.md'), 'hello');
    await expect(
      new ListingReader(new RootPathPolicy(root)).readEntry(relativePath('notes.md'))
    ).resolves.toMatchObject({
      success: true,
      data: { name: 'notes.md', entry: { kind: 'file' }, size: 5 },
    });
  });
});

function names(result: { success: true; data: ReadEntry[] } | { success: false }): string[] {
  return result.success ? result.data.map((entry) => entry.name).sort() : [];
}

async function makeRoot(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-listing-reader-')));
  roots.push(root);
  return root;
}
