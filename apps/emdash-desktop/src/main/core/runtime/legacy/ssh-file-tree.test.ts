import { afterEach, describe, expect, it, vi } from 'vitest';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileEntry, FileListResult } from '@main/core/fs/types';
import { LegacySshFilesRuntime } from './ssh-files';

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
    vi.spyOn(SshFileSystem.prototype, 'list').mockImplementation(async (dirPath = '') => {
      if (dirPath === '') return listResult([dirEntry('src')]);
      if (dirPath === 'src') return listResult([fileEntry('src/index.ts')]);
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

    const src = rootSnapshot.data.entries.find(([, node]) => node.path === 'src')?.[1];
    expect(src).toMatchObject({ path: 'src', type: 'directory', parentId: null });
    expect(src).toBeDefined();
    if (!src) return;

    const expanded = await tree.expandDir(src.id);
    expect(expanded.success).toBe(true);

    const expandedSnapshot = await tree.getSnapshot();
    expect(expandedSnapshot.success).toBe(true);
    if (!expandedSnapshot.success) return;

    expect(expandedSnapshot.data.entries.map(([, node]) => node.path).sort()).toEqual([
      'src',
      'src/index.ts',
    ]);
    expect(
      expandedSnapshot.data.entries.find(([, node]) => node.path === 'src/index.ts')?.[1]
    ).toMatchObject({ parentId: src.id });

    await opened.data.release();
    await runtime.dispose();
  });
});
