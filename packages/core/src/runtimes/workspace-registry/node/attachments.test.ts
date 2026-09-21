import { access, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deferred } from '@emdash/shared/testing';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalAttachmentStore } from '#services/attachments/node/local-attachment-store';
import { workspaceRegistryContract } from '../api';
import { createWorkspaceRegistryController } from './api/controller';
import { workspaceRegistryStore } from './persistence/store';
import { WorkspaceRegistryRuntime } from './runtime';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup() {
  const handle = await workspaceRegistryStore.openTemp();
  cleanups.push(() => handle.close());
  const root = await mkdtemp(join(dirname(handle.path), 'workspace-attachment-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const attachments = new LocalAttachmentStore(join(root, 'attachments'));
  const runtime = new WorkspaceRegistryRuntime({ handle, attachments });
  cleanups.push(() => runtime.dispose());
  const wire = createTestWire(
    workspaceRegistryContract,
    createWorkspaceRegistryController(runtime)
  );
  cleanups.push(() => wire.dispose());
  const workspacePath = join(root, 'workspace');
  await mkdir(workspacePath);
  const result = await wire.client.createWorkspace({
    workspaceId: 'workspace-1',
    path: workspacePath,
  });
  if (!result.success) throw new Error(JSON.stringify(result.error));
  return { ...wire, runtime, attachments, root, workspacePath };
}
const upload = () => ({
  name: 'notes.txt',
  mimeType: 'text/plain',
  size: 3,
  source: (async function* () {
    yield new Uint8Array([1, 2, 3]);
  })(),
});
const owner = { workspaceId: 'workspace-1' };

describe('workspace-owned shell attachments', () => {
  it('does not hold the registry mutation lane while removing attachment bytes', async () => {
    const { client, attachments, root } = await setup();
    const entered = deferred<void>();
    const release = deferred<void>();
    const cleanup = attachments.deleteOwner.bind(attachments);
    vi.spyOn(attachments, 'deleteOwner').mockImplementation(async (owner) => {
      entered.resolve();
      await release.promise;
      await cleanup(owner);
    });
    const deletion = client.deleteWorkspace(owner);
    await entered.promise;
    try {
      const path = join(root, 'other-workspace');
      await mkdir(path);
      let completed = false;
      const creation = client.createWorkspace({ workspaceId: 'other', path }).then((result) => {
        expect(result.success).toBe(true);
        completed = true;
      });
      await vi.waitFor(() => expect(completed).toBe(true));
      await creation;
    } finally {
      release.resolve();
      await deletion;
    }
  });

  it('survives deactivation and cleans up on workspace removal without deleting workspace files', async () => {
    const { client, workspacePath } = await setup();
    const result = await client.attachments.upload(owner, upload());
    if (!result.success) throw new Error(result.error.message);
    expect(result.data.targetPath).toContain(`/workspaces/workspace-1/${result.data.id}/`);
    await client.deactivateWorkspace(owner);
    expect(await readFile(result.data.targetPath)).toEqual(Buffer.from([1, 2, 3]));
    const downloaded = await client.attachments.download({
      ...owner,
      attachmentId: result.data.id,
    });
    if (!downloaded.success) throw new Error(downloaded.error.message);
    expect(await downloaded.data.bytes()).toEqual(new Uint8Array([1, 2, 3]));
    expect((await client.deleteWorkspace(owner)).success).toBe(true);
    await expect(access(result.data.targetPath)).rejects.toThrow();
    await expect(access(workspacePath)).resolves.toBeUndefined();
    expect((await client.deleteWorkspace(owner)).success).toBe(true);
    await expect(client.attachments.upload(owner, upload())).resolves.toMatchObject({
      success: false,
      error: { type: 'owner-not-found' },
    });
  });

  it('does not resurrect a workspace attachment directory when deletion wins a pending transfer', async () => {
    const { client, root } = await setup();
    const started = deferred<void>();
    const finish = deferred<void>();
    const pending = client.attachments.upload(owner, {
      ...upload(),
      source: (async function* () {
        started.resolve();
        await finish.promise;
        yield new Uint8Array([1, 2, 3]);
      })(),
    });
    await started.promise;
    expect((await client.deleteWorkspace(owner)).success).toBe(true);
    finish.resolve();
    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { type: 'owner-not-found' },
    });
    await expect(access(join(root, 'attachments/workspaces/workspace-1'))).rejects.toThrow();
    expect(await readdir(join(root, 'attachments/.staging/workspace'))).toEqual([]);
  });

  it('keeps workspace deletion successful when attachment cleanup fails', async () => {
    const { client, attachments } = await setup();
    vi.spyOn(attachments, 'deleteOwner').mockRejectedValue(new Error('disk unavailable'));
    expect((await client.deleteWorkspace(owner)).success).toBe(true);
    await expect(client.attachments.upload(owner, upload())).resolves.toMatchObject({
      success: false,
      error: { type: 'owner-not-found' },
    });
  });
});
