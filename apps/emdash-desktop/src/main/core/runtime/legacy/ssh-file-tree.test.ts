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

    const expanded = await tree.expandDir(src.id);
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
});
