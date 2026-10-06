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
  it.each(['definition', 'typeDefinition', 'references'] as const)(
    'routes %s without losing its options',
    async (operation) => {
      const handler = vi.fn(async () => ok([]));
      const runtimes = new RuntimeBroker({
        resolve: async () => ok({ lsp: { [operation]: handler } } as never),
      });
      const wire = createTestWire(editorLspContract, createEditorLspImpl({ runtimes }));
      const host = { type: 'remote' as const, id: 'host' };
      const session = { host, root, clientId: 'client', serverId: 'typescript' };
      const query = {
        session,
        path: root,
        version: 1,
        position: { line: 0, character: 1 },
        includeDeclaration: false,
      };
      try {
        expect(await wire.client[operation](query)).toEqual(ok([]));
        expect(handler).toHaveBeenCalledWith(
          expect.objectContaining({
            session: { root, clientId: 'client', serverId: 'typescript' },
            ...(operation === 'references' ? { includeDeclaration: false } : {}),
          }),
          expect.objectContaining({ signal: expect.any(AbortSignal) })
        );
      } finally {
        await wire.dispose();
        runtimes.dispose();
      }
    }
  );

  it('carries the saved snapshot through the remote host route', async () => {
    const documentSaved = vi.fn(async () => ok(undefined));
    const runtimes = new RuntimeBroker({
      resolve: async () => ok({ lsp: { documentSaved } } as never),
    });
    const wire = createTestWire(editorLspContract, createEditorLspImpl({ runtimes }), {
      validate: 'full',
    });
    const session = {
      host: { type: 'remote' as const, id: 'host' },
      root,
      clientId: 'client',
      serverId: 'typescript',
    };
    try {
      expect(
        await wire.client.documentSaved({ session, path: root, text: 'saved snapshot' })
      ).toEqual(ok(undefined));
      expect(documentSaved).toHaveBeenCalledWith(
        {
          session: { root, clientId: 'client', serverId: 'typescript' },
          path: root,
          text: 'saved snapshot',
        },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    } finally {
      await wire.dispose();
      runtimes.dispose();
    }
  });

  it('resolves roots and sends deltas on the file host', async () => {
    const resolveProjectRoot = vi.fn(async () => ok(root));
    const applyDocumentEdit = vi.fn(async () => ok(undefined));
    const resolve = vi.fn(async () =>
      ok({ lsp: { resolveProjectRoot, applyDocumentEdit } } as never)
    );
    const runtimes = new RuntimeBroker({ resolve });
    const wire = createTestWire(editorLspContract, createEditorLspImpl({ runtimes }));
    const host = { type: 'remote' as const, id: 'host' };
    try {
      expect(
        await wire.client.resolveProjectRoot({
          host,
          workspaceRoot: root,
          path: root,
          serverId: 'typescript',
        })
      ).toEqual(ok(root));
      expect(resolveProjectRoot).toHaveBeenCalledWith(
        { workspaceRoot: root, path: root, serverId: 'typescript' },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      const change = {
        path: root,
        baseVersion: 1,
        version: 2,
        edit: { start: 1, deleteCount: 1, text: 'x' },
      };
      await wire.client.applyDocumentEdit({
        session: { host, root, clientId: 'client', serverId: 'typescript' },
        change,
      });
      expect(applyDocumentEdit).toHaveBeenCalledWith(
        { session: { root, clientId: 'client', serverId: 'typescript' }, change },
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(resolve).toHaveBeenCalledWith(host);
    } finally {
      await wire.dispose();
      runtimes.dispose();
    }
  });
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
      const result = await wire.client.restartServer({
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
