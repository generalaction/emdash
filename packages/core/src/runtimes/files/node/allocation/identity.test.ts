import { describe, expect, it } from 'vitest';
import type { HostAbsolutePath } from '#primitives/path/api';
import type { TreeKey } from '#runtimes/files/api';
import { resolveRootIdentity, treeIdentity } from './identity';

describe('resolveRootIdentity', () => {
  it('rejects paths whose style does not belong to the runtime host', async () => {
    const incompatible: HostAbsolutePath =
      process.platform === 'win32'
        ? { root: { kind: 'posix' }, segments: ['workspace'] }
        : { root: { kind: 'drive', driveLetter: 'C' }, segments: ['workspace'] };

    await expect(resolveRootIdentity(incompatible)).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path', message: expect.stringContaining('not valid on this host') },
    });
  });
});

describe('treeIdentity', () => {
  const fakeRoot = {
    rootId: 'root-1',
    root: { root: { kind: 'posix' as const }, segments: ['workspace'] } as HostAbsolutePath,
    rootPath: '/workspace',
  };
  const fakeRootKey: HostAbsolutePath = {
    root: { kind: 'posix' },
    segments: ['workspace'],
  } as HostAbsolutePath;

  function key(exclusions: string[]): TreeKey {
    return { root: fakeRootKey, sessionId: 'session-1', exclusions };
  }

  it('produces the same treeId for identical exclusion sets in different order', () => {
    const a = treeIdentity(fakeRoot, key(['dist', 'build', 'node_modules']));
    const b = treeIdentity(fakeRoot, key(['node_modules', 'dist', 'build']));
    expect(a.treeId).toBe(b.treeId);
  });

  it('produces different treeIds for genuinely different exclusion sets', () => {
    const a = treeIdentity(fakeRoot, key(['dist']));
    const b = treeIdentity(fakeRoot, key(['build']));
    expect(a.treeId).not.toBe(b.treeId);
  });

  it('stores exclusions in canonical sorted order', () => {
    const identity = treeIdentity(fakeRoot, key(['dist', 'build']));
    expect(identity.exclusions).toEqual(['build', 'dist']);
  });
});
