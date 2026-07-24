import { filesContract } from '@emdash/core/runtimes/files/api';
import { describe, expect, it } from 'vitest';
import { portablePath } from '@core/primitives/desktop-runtime/api';
import { editorContract } from './contract';

describe('editorContract', () => {
  it('owns the renderer file operations needed by the editor', () => {
    expect(Object.keys(editorContract.fs)).toEqual([
      'exists',
      'realPath',
      'readText',
      'readBytes',
      'upload',
    ]);
    expect(Object.keys(editorContract.mutations)).toEqual([
      'createFile',
      'createDirectory',
      'rename',
      'move',
      'delete',
    ]);
    expect(Object.keys(editorContract.tree.model.mutations)).toEqual(
      Object.keys(filesContract.tree.model.mutations)
    );
    expect(Object.keys(editorContract.content.mutations)).toEqual(
      Object.keys(filesContract.content.mutations)
    );
  });

  it('uses workspace identities and portable paths instead of host roots', () => {
    const relative = portablePath('src/index.ts');
    expect(
      editorContract.content.keySchema.parse({
        workspaceId: 'workspace-1',
        relative,
      })
    ).toEqual({ workspaceId: 'workspace-1', relative });
    expect(() =>
      editorContract.content.keySchema.parse({
        root: '/repo/worktree',
        relative,
      })
    ).toThrow();
  });
});
