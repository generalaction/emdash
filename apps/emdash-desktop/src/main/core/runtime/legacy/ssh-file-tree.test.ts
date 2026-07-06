import { afterEach, describe, expect, it, vi } from 'vitest';
import { LegacySshFilesRuntime } from './ssh-files';
import { SshFileSystem } from './ssh-legacy-fs';
import type { FileEntry, FileListResult } from './ssh-legacy-fs-types';

function listResult(entries: FileEntry[]): FileListResult {
  return { entries, total: entries.length };
}

function fileEntry(path: string): FileEntry {
  return {
    path,
    type: 'file',
    size: 1,
    mtime: new Date(1_000),
    mode: 0o100644,
  };
}

function dirEntry(path: string): FileEntry {
  return {
    path,
    type: 'dir',
    size: 0,
    mtime: new Date(1_000),
    mode: 0o040755,
  };
}

function symlinkEntry(
  path: string,
  targetType: 'file' | 'directory' | 'unknown' = 'unknown'
): FileEntry {
  return {
    path,
    type: 'symlink',
    symlink: { targetType, broken: false },
    size: 0,
    mtime: new Date(1_000),
    mode: 0o120755,
  };
}

describe('LegacySshFilesRuntime file tree', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('loads children for expanded remote directory scopes', async () => {
    vi.spyOn(SshFileSystem.prototype, 'list').mockImplementation(async (dirPath = '/repo') => {
      if (dirPath === '/repo') return listResult([dirEntry('/repo/src')]);
      if (dirPath === '/repo/src') return listResult([fileEntry('/repo/src/index.ts')]);
      return listResult([]);
    });

    const runtime = new LegacySshFilesRuntime({} as never);
    const opened = await runtime.openTree('/repo');
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const tree = opened.data.value;
    const rootSnapshot = await tree.getSnapshot();
    expect(rootSnapshot.success).toBe(true);
    if (!rootSnapshot.success) return;

    const src = rootSnapshot.data.entries.find(([, node]) => node.path === '/repo/src')?.[1];
    expect(src).toMatchObject({ path: '/repo/src', type: 'directory', parentId: null });
    expect(src).toBeDefined();
    if (!src) return;

    const expanded = await tree.registerDir(src.id);
    expect(expanded.success).toBe(true);

    const expandedSnapshot = await tree.getSnapshot();
    expect(expandedSnapshot.success).toBe(true);
    if (!expandedSnapshot.success) return;

    expect(expandedSnapshot.data.entries.map(([, node]) => node.path).sort()).toEqual([
      '/repo/src',
      '/repo/src/index.ts',
    ]);
    expect(
      expandedSnapshot.data.entries.find(([, node]) => node.path === '/repo/src/index.ts')?.[1]
    ).toMatchObject({ parentId: src.id });

    await opened.data.release();
    await runtime.dispose();
  });

  it('lists noisy directories and symlink entries in the remote file tree', async () => {
    vi.spyOn(SshFileSystem.prototype, 'list').mockImplementation(async (dirPath = '/repo') => {
      if (dirPath === '/repo') {
        return listResult([
          dirEntry('/repo/node_modules'),
          symlinkEntry('/repo/package-link', 'directory'),
          fileEntry('/repo/README.md'),
        ]);
      }
      if (dirPath === '/repo/package-link')
        return listResult([fileEntry('/repo/package-link/a.js')]);
      return listResult([]);
    });

    const runtime = new LegacySshFilesRuntime({} as never);
    const opened = await runtime.openTree('/repo');
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const snapshot = await opened.data.value.getSnapshot();
    expect(snapshot.success).toBe(true);
    if (!snapshot.success) return;

    expect(snapshot.data.entries.map(([, node]) => node.path)).toEqual([
      '/repo/node_modules',
      '/repo/package-link',
      '/repo/README.md',
    ]);
    expect(
      snapshot.data.entries.find(([, node]) => node.path === '/repo/package-link')?.[1]
    ).toMatchObject({
      type: 'symlink',
      symlink: { targetType: 'directory', broken: false },
    });

    const link = snapshot.data.entries.find(([, node]) => node.path === '/repo/package-link')?.[1];
    expect(link).toBeDefined();
    if (!link) return;

    const expanded = await opened.data.value.registerDir(link.id);
    expect(expanded.success).toBe(true);

    const expandedSnapshot = await opened.data.value.getSnapshot();
    expect(expandedSnapshot.success).toBe(true);
    if (!expandedSnapshot.success) return;
    expect(expandedSnapshot.data.entries.map(([, node]) => node.path)).toContain(
      '/repo/package-link/a.js'
    );

    await opened.data.release();
    await runtime.dispose();
  });

  it('lists node_modules below an expanded remote directory', async () => {
    vi.spyOn(SshFileSystem.prototype, 'list').mockImplementation(async (dirPath = '/repo') => {
      if (dirPath === '/repo') return listResult([dirEntry('/repo/example-apps')]);
      if (dirPath === '/repo/example-apps')
        return listResult([dirEntry('/repo/example-apps/credential-sync')]);
      if (dirPath === '/repo/example-apps/credential-sync') {
        return listResult([
          dirEntry('/repo/example-apps/credential-sync/lib'),
          dirEntry('/repo/example-apps/credential-sync/node_modules'),
          dirEntry('/repo/example-apps/credential-sync/pages'),
        ]);
      }
      return listResult([]);
    });

    const runtime = new LegacySshFilesRuntime({} as never);
    const opened = await runtime.openTree('/repo');
    expect(opened.success).toBe(true);
    if (!opened.success) return;

    const tree = opened.data.value;
    let snapshot = await tree.getSnapshot();
    expect(snapshot.success).toBe(true);
    if (!snapshot.success) return;

    const exampleApps = snapshot.data.entries.find(
      ([, node]) => node.path === '/repo/example-apps'
    )?.[1];
    expect(exampleApps).toBeDefined();
    if (!exampleApps) return;
    await tree.registerDir(exampleApps.id);

    snapshot = await tree.getSnapshot();
    expect(snapshot.success).toBe(true);
    if (!snapshot.success) return;
    const credentialSync = snapshot.data.entries.find(
      ([, node]) => node.path === '/repo/example-apps/credential-sync'
    )?.[1];
    expect(credentialSync).toBeDefined();
    if (!credentialSync) return;
    await tree.registerDir(credentialSync.id);

    snapshot = await tree.getSnapshot();
    expect(snapshot.success).toBe(true);
    if (!snapshot.success) return;
    expect(snapshot.data.entries.map(([, node]) => node.path)).toContain(
      '/repo/example-apps/credential-sync/node_modules'
    );

    await opened.data.release();
    await runtime.dispose();
  });
});
