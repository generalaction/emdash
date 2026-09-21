import { readFile, access, mkdtemp, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { deferred } from '@emdash/shared/testing';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_ATTACHMENT_BYTES } from '#services/attachments/api';
import { LocalAttachmentStore } from '#services/attachments/node/local-attachment-store';
import { conversationsContract } from '../api';
import { createConversationsController } from './api/controller';
import { conversationsStore } from './persistence/store';
import { ConversationsRuntime } from './runtime';

const cleanups: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function setup(type: 'acp' | 'pty' = 'acp') {
  const handle = await conversationsStore.openTemp();
  cleanups.push(() => handle.close());
  const root = await mkdtemp(join(dirname(handle.path), 'conversation-attachment-test-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const attachments = new LocalAttachmentStore(root);
  const runtime = new ConversationsRuntime({ handle, attachments });
  cleanups.push(() => runtime.dispose());
  const wire = createTestWire(conversationsContract, createConversationsController(runtime));
  cleanups.push(() => wire.dispose());
  const created = await wire.client.create({
    conversationId: 'conv-1',
    provider: 'claude-code',
    type,
    cwd: '/repo',
    workspacePath: '/repo',
    idRegime: 'provider-minted',
    createdAt: 1,
    title: 'Attachments',
    config: {},
  });
  expect(created.success).toBe(true);
  return { ...wire, attachments, runtime };
}

const uploadFile = (data = new Uint8Array([1, 2, 3])) => ({
  name: 'image.png',
  mimeType: 'image/png',
  size: data.byteLength,
  source: (async function* () {
    yield data;
  })(),
});

describe('conversation attachments', () => {
  it.each(['acp', 'pty'] as const)(
    'uploads and downloads bytes without a live %s session',
    async (type) => {
      const { client } = await setup(type);
      const result = await client.attachments.upload({ conversationId: 'conv-1' }, uploadFile());
      if (!result.success) throw new Error(result.error.message);
      expect(result.data.targetPath).toContain(
        `/conversations/conv-1/${result.data.id}/content.png`
      );
      expect(await readFile(result.data.targetPath)).toEqual(Buffer.from([1, 2, 3]));
      const download = await client.attachments.download({
        conversationId: 'conv-1',
        attachmentId: result.data.id,
      });
      if (!download.success) throw new Error(download.error.message);
      expect(await download.data.bytes()).toEqual(new Uint8Array([1, 2, 3]));
      await expect(
        client.attachments.download({ conversationId: 'other', attachmentId: result.data.id })
      ).resolves.toMatchObject({ success: false, error: { type: 'owner-not-found' } });
      await client.delete({ conversationId: 'conv-1' });
      await expect(access(result.data.targetPath)).rejects.toThrow();
      await expect(client.delete({ conversationId: 'conv-1' })).resolves.toMatchObject({
        success: true,
      });
    }
  );

  it('deletes one attachment without deleting its conversation', async () => {
    const { client } = await setup();
    const uploaded = await client.attachments.upload({ conversationId: 'conv-1' }, uploadFile());
    if (!uploaded.success) throw new Error(uploaded.error.message);
    await client.attachments.delete({ conversationId: 'conv-1', attachmentId: uploaded.data.id });
    await expect(access(uploaded.data.targetPath)).rejects.toThrow();
    await expect(
      client.attachments.download({ conversationId: 'conv-1', attachmentId: uploaded.data.id })
    ).resolves.toMatchObject({ success: false, error: { type: 'attachment-not-found' } });
    expect(
      (await client.attachments.upload({ conversationId: 'conv-1' }, uploadFile())).success
    ).toBe(true);
  });

  it('does not recreate attachment storage when deletion wins a pending upload', async () => {
    const { client, attachments } = await setup('pty');
    const put = vi.spyOn(attachments, 'stage');
    const started = deferred<void>();
    const finish = deferred<void>();
    const pending = client.attachments.upload(
      { conversationId: 'conv-1' },
      {
        ...uploadFile(),
        source: (async function* () {
          started.resolve();
          await finish.promise;
          yield new Uint8Array([1, 2, 3]);
        })(),
      }
    );
    await started.promise;
    await client.delete({ conversationId: 'conv-1' });
    finish.resolve();
    await expect(pending).resolves.toMatchObject({
      success: false,
      error: { type: 'owner-not-found' },
    });
    expect(put).toHaveBeenCalledOnce();
  });

  it('keeps conversation deletion successful when attachment cleanup fails', async () => {
    const { client, attachments } = await setup();
    vi.spyOn(attachments, 'deleteOwner').mockRejectedValue(new Error('disk unavailable'));
    await expect(client.delete({ conversationId: 'conv-1' })).resolves.toMatchObject({
      success: true,
    });
    await expect(
      client.attachments.upload({ conversationId: 'conv-1' }, uploadFile())
    ).resolves.toMatchObject({ success: false, error: { type: 'owner-not-found' } });
  });

  it('rejects oversized uploads before storage', async () => {
    const { client, attachments } = await setup();
    const put = vi.spyOn(attachments, 'stage');
    await expect(
      client.attachments.upload(
        { conversationId: 'conv-1' },
        { ...uploadFile(), size: MAX_ATTACHMENT_BYTES + 1 }
      )
    ).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });
});
