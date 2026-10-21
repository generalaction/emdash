import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostAbsolutePath } from '#primitives/path/api';
import { runtimeRoot } from '#runtimes/files/node/testing/paths';
import { resolveAbsoluteFileLocation, resolveRootIdentity } from './identity';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

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

describe('resolveAbsoluteFileLocation', () => {
  it('resolves the canonical parent as a children-scoped root plus the file name', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'note.txt'), 'hi');

    const location = await resolveAbsoluteFileLocation(runtimeRoot(path.join(dir, 'note.txt')));
    expect(location).toMatchObject({
      success: true,
      data: {
        root: { rootPath: dir, watchScope: 'children' },
        relative: 'note.txt',
      },
    });
  });

  it('never aliases a children-scoped parent root with a recursive workspace root', async () => {
    const dir = await makeDir();
    await writeFile(path.join(dir, 'note.txt'), 'hi');

    const asWorkspaceRoot = await resolveRootIdentity(runtimeRoot(dir));
    const asFileParent = await resolveAbsoluteFileLocation(runtimeRoot(path.join(dir, 'note.txt')));
    if (!asWorkspaceRoot.success || !asFileParent.success) {
      throw new Error('Expected both resolutions to succeed');
    }
    expect(asFileParent.data.root.rootPath).toBe(asWorkspaceRoot.data.rootPath);
    expect(asFileParent.data.root.rootId).not.toBe(asWorkspaceRoot.data.rootId);
  });

  it('rejects the filesystem root and reports a missing parent as not-found', async () => {
    const dir = await makeDir();
    const fsRoot: HostAbsolutePath =
      process.platform === 'win32'
        ? ({ root: { kind: 'drive', driveLetter: 'C' }, segments: [] } as HostAbsolutePath)
        : ({ root: { kind: 'posix' }, segments: [] } as HostAbsolutePath);

    await expect(resolveAbsoluteFileLocation(fsRoot)).resolves.toMatchObject({
      success: false,
      error: { type: 'invalid-path' },
    });
    await expect(
      resolveAbsoluteFileLocation(runtimeRoot(path.join(dir, 'missing-dir', 'file.txt')))
    ).resolves.toMatchObject({ success: false, error: { type: 'not-found' } });
  });
});

async function makeDir(): Promise<string> {
  const dir = await realpath(await mkdtemp(path.join(tmpdir(), 'emdash-files-identity-')));
  roots.push(dir);
  return dir;
}
