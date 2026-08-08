import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { encodeResourceUri, hostFileRef, parseAbsolute } from '@emdash/core/primitives/path/api';
import { filesContract } from '@emdash/core/runtimes/files/api';
import { describe, expect, it } from 'vitest';
import { filesDomain, filesWireContract } from './contract';

const uri = resourceUri('/repo/worktree/src/index.ts');
const rootUri = resourceUri('/repo/worktree');

describe('filesWireContract', () => {
  it('owns the ResourceUri-keyed file operations', () => {
    expect(filesDomain).toBe('files');
    expect(Object.keys(filesWireContract.fs)).toEqual([
      'exists',
      'realPath',
      'readText',
      'readBytes',
      'upload',
    ]);
    expect(Object.keys(filesWireContract.mutations)).toEqual([
      'createFile',
      'createDirectory',
      'rename',
      'move',
      'delete',
    ]);
    expect(Object.keys(filesWireContract.tree.model.mutations)).toEqual(
      Object.keys(filesContract.tree.model.mutations)
    );
    expect(Object.keys(filesWireContract.content.mutations)).toEqual(
      Object.keys(filesContract.content.mutations)
    );
  });

  it('keys content by ResourceUri and source with no workspace identity', () => {
    expect(filesWireContract.content.keySchema.parse({ uri, source: 'disk' })).toEqual({
      uri,
      source: 'disk',
    });
    expect(() =>
      filesWireContract.content.keySchema.parse({ workspaceId: 'workspace-1', relative: 'a.ts' })
    ).toThrow();
    expect(() => filesWireContract.content.keySchema.parse({ uri })).toThrow();
    expect(() =>
      filesWireContract.content.keySchema.parse({ uri, source: { ref: 'HEAD' } })
    ).toThrow();
    expect(() =>
      filesWireContract.content.keySchema.parse({ uri: '/repo/worktree/a.ts', source: 'disk' })
    ).toThrow();
  });

  it('keys the tree by root ResourceUri, sessionId, and exclusions', () => {
    expect(
      filesWireContract.tree.model.keySchema.parse({
        root: rootUri,
        sessionId: 'session-1',
        exclusions: ['node_modules'],
      })
    ).toEqual({ root: rootUri, sessionId: 'session-1', exclusions: ['node_modules'] });
    expect(() =>
      filesWireContract.tree.model.keySchema.parse({
        workspaceId: 'workspace-1',
        sessionId: 'session-1',
      })
    ).toThrow();
  });

  it('keys rename and move by source and target ResourceUri', () => {
    const target = resourceUri('/repo/worktree/src/renamed.ts');
    expect(filesWireContract.mutations.rename.input.parse({ uri, to: target })).toEqual({
      uri,
      to: target,
    });
    expect(() => filesWireContract.mutations.move.input.parse({ uri, to: 'renamed.ts' })).toThrow();
  });
});

function resourceUri(path: string) {
  const parsed = parseAbsolute(path, { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return encodeResourceUri(hostFileRef(LOCAL_HOST_REF, parsed.data));
}
