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
      'createFile',
      'createDirectory',
      'rename',
      'move',
      'copy',
      'delete',
    ]);
    expect(Object.keys(filesWireContract.listing.mutations)).toEqual(
      Object.keys(filesContract.listing.mutations)
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

  it('accepts structured GitRef sources with no checkout root in the key', () => {
    for (const ref of [
      { kind: 'head' },
      { kind: 'staged' },
      { kind: 'unstaged' },
      { kind: 'commit', sha: 'abc123' },
      { kind: 'tag', name: 'v1.0.0' },
      { kind: 'branch', branch: { type: 'local', branch: 'main' } },
    ]) {
      expect(filesWireContract.content.keySchema.parse({ uri, source: { ref } })).toEqual({
        uri,
        source: { ref },
      });
    }
    expect(() =>
      filesWireContract.content.keySchema.parse({ uri, source: { ref: { kind: 'unknown' } } })
    ).toThrow();
  });

  it('keys a folder listing by root ResourceUri and folder path, with no consumer identity', () => {
    expect(filesWireContract.listing.keySchema.parse({ root: rootUri, path: 'src/lib' })).toEqual({
      root: rootUri,
      path: 'src/lib',
    });
    expect(() =>
      filesWireContract.listing.keySchema.parse({ root: rootUri, path: '../outside' })
    ).toThrow();
    expect(() =>
      filesWireContract.listing.keySchema.parse({ workspaceId: 'workspace-1', path: '' })
    ).toThrow();
  });
});

function resourceUri(path: string) {
  const parsed = parseAbsolute(path, { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return encodeResourceUri(hostFileRef(LOCAL_HOST_REF, parsed.data));
}
