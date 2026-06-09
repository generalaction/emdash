import { describe, expect, it } from 'vitest';
import {
  clearDraggedWorkspaceFile,
  getDraggedWorkspaceFile,
  hasDraggedWorkspaceFile,
  resolveWorkspaceFileTargetPath,
  setDraggedWorkspaceFile,
} from '@renderer/lib/drag-files';

function makeDataTransfer(): DataTransfer {
  const values = new Map<string, string>();
  const transfer = {
    types: [] as string[],
    files: [] as unknown as FileList,
    effectAllowed: 'all',
    setData(type: string, value: string) {
      if (!values.has(type)) this.types.push(type);
      values.set(type, value);
    },
    getData(type: string) {
      return values.get(type) ?? '';
    },
  };
  return transfer as unknown as DataTransfer;
}

describe('drag-files', () => {
  it('resolves workspace-relative paths into the workspace target path', () => {
    expect(resolveWorkspaceFileTargetPath('/tmp/repo/', 'src/file name.ts')).toBe(
      '/tmp/repo/src/file name.ts'
    );
    expect(resolveWorkspaceFileTargetPath('C:\\repo\\', 'src/file name.ts')).toBe(
      'C:\\repo\\src\\file name.ts'
    );
  });

  it('carries workspace file payloads for same-window drops', () => {
    const dataTransfer = makeDataTransfer();

    setDraggedWorkspaceFile(dataTransfer, {
      workspaceId: 'workspace-1',
      workspaceRootPath: '/remote/repo',
      relPath: 'src/index.ts',
      targetPlatform: 'linux',
    });

    expect(hasDraggedWorkspaceFile(dataTransfer)).toBe(true);
    expect(getDraggedWorkspaceFile(dataTransfer)).toEqual({
      workspaceId: 'workspace-1',
      relPath: 'src/index.ts',
      targetPath: '/remote/repo/src/index.ts',
      targetPlatform: 'linux',
    });
    expect(dataTransfer.getData('text/plain')).toBe('/remote/repo/src/index.ts');
  });

  it('does not accept stale workspace state without a matching transfer marker', () => {
    const sourceTransfer = makeDataTransfer();
    setDraggedWorkspaceFile(sourceTransfer, {
      workspaceId: 'workspace-1',
      workspaceRootPath: '/repo',
      relPath: 'src/index.ts',
    });

    const unrelatedTransfer = makeDataTransfer();

    expect(hasDraggedWorkspaceFile(unrelatedTransfer)).toBe(false);
    expect(getDraggedWorkspaceFile(unrelatedTransfer)).toBeNull();
    clearDraggedWorkspaceFile();
  });

  it('falls back to the serialized transfer payload after dragend clears same-window state', () => {
    const dataTransfer = makeDataTransfer();
    setDraggedWorkspaceFile(dataTransfer, {
      workspaceId: 'workspace-1',
      workspaceRootPath: '/repo',
      relPath: 'src/index.ts',
    });
    clearDraggedWorkspaceFile();

    expect(getDraggedWorkspaceFile(dataTransfer)).toEqual({
      workspaceId: 'workspace-1',
      relPath: 'src/index.ts',
      targetPath: '/repo/src/index.ts',
    });
  });
});
