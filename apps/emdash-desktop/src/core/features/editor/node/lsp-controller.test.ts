import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { parseNativeAbsolute } from '@emdash/core/primitives/path/api';
import { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { ok } from '@emdash/shared';
import { createTestWire } from '@emdash/wire/testing';
import { describe, expect, it, vi } from 'vitest';
import { editorLspContract } from '../api/lsp-contract';
import { createEditorLspImpl } from './lsp-controller';

const parsed = parseNativeAbsolute('/worktree');
if (!parsed.success) throw new Error('invalid test path');
const root = parsed.data;

describe('editor language services routing', () => {
  it.each([LOCAL_HOST_REF, { type: 'remote' as const, id: 'ssh:example' }])(
    'routes requests and cancellation to the owning host: %o',
    async (host) => {
      const hover = vi.fn(async () => ok({ contents: 'type information' }));
      const resolve = vi.fn(async () => ok({ lsp: { hover } } as never));
      const runtimes = new RuntimeBroker({ resolve });
      const wire = createTestWire(editorLspContract, createEditorLspImpl({ runtimes }));
      try {
        const session = { host, root, clientId: 'editor', serverId: 'typescript' as const };
        const result = await wire.client.hover({
          session,
          path: root,
          version: 1,
          position: { line: 0, character: 0 },
        });
        expect(result).toEqual(ok({ contents: 'type information' }));
        expect(resolve).toHaveBeenCalledWith(host);
        expect(hover).toHaveBeenCalledWith(
          expect.objectContaining({
            session: { root, clientId: 'editor', serverId: 'typescript' },
          }),
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
      } finally {
        await wire.dispose();
        runtimes.dispose();
      }
    }
  );

  it('does not call an LSP endpoint on an older remote server', async () => {
    const resolve = vi.fn();
    const runtimes = new RuntimeBroker({ resolve });
    const wire = createTestWire(
      editorLspContract,
      createEditorLspImpl({ runtimes, isSupported: async () => false })
    );
    try {
      const result = await wire.client.restart({
        host: LOCAL_HOST_REF,
        root,
        clientId: 'editor',
        serverId: 'typescript',
      });
      expect(result).toMatchObject({ success: false, error: { type: 'unsupported' } });
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await wire.dispose();
      runtimes.dispose();
    }
  });
});
