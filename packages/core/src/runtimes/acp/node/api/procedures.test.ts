import { ok } from '@emdash/shared';
import type { WireFile } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import type { AcpRuntime } from '#runtimes/acp/node/runtime/runtime';
import { createAcpProcedures } from './procedures';

describe('ACP attachment procedures', () => {
  it('always transfers uploaded bytes into the target Host runtime', async () => {
    const data = new Uint8Array([1, 2, 3]);
    const bytes = vi.fn(async () => data);
    const uploadAttachment = vi.fn(async () =>
      ok({
        id: 'attachment-1',
        name: 'notes.txt',
        mimeType: 'text/plain',
        targetPath: '/target-host/acp-attachments/attachment-1',
      })
    );
    const runtime = { uploadAttachment } as unknown as AcpRuntime;
    const procedures = createAcpProcedures(runtime);
    const file: WireFile = {
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: data.byteLength,
      bytes,
      stream: async function* () {
        yield data;
      },
      file: async () => file,
      cancel: () => undefined,
    };

    await procedures.uploadAttachment({ conversationId: 'conversation-1' }, file);

    expect(bytes).toHaveBeenCalledOnce();
    expect(uploadAttachment).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      data,
      mimeType: 'text/plain',
      name: 'notes.txt',
    });
  });
});
