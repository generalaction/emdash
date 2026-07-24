import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { err, ok } from '@emdash/shared';
import type { LiveSource } from '@emdash/wire';
import { encodeTopic, isDownloadFileOpenResult } from '@emdash/wire/api';
import { describe, expect, it, vi } from 'vitest';
import { hostPathFromNative, portablePath } from '@core/primitives/desktop-runtime/api';
import { editorContract } from '../api';
import type { EditorRuntimeResolveError as RuntimeResolveError } from '../api/runtime-adapter';
import { createEditorWireController } from './wire-controller';

const editorBuffer = {
  saveBuffer: vi.fn(),
  clearBuffer: vi.fn(),
  listBuffers: vi.fn(async () => []),
} as never;

const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: LOCAL_HOST_REF,
  path: '/repo/worktree',
} as const;

describe('createEditorWireController', () => {
  it('resolves a client for each file procedure call', async () => {
    const exists = vi.fn(async () => ok(true));
    const client = vi.fn(async () => ok({ files: { fs: { exists } } }));
    const resolve = vi.fn(async () => identity);
    const controller = createEditorWireController({
      editorBuffer,
      runtimes: { client } as never,
      workspaceIdentity: { resolve },
    });
    const input = {
      workspaceId: identity.workspaceId,
      relative: portablePath('src/index.ts'),
    };

    await expect(controller.call('fs.exists', input)).resolves.toEqual(ok(true));
    await expect(controller.call('fs.exists', input)).resolves.toEqual(ok(true));

    expect(resolve).toHaveBeenCalledTimes(2);
    expect(client).toHaveBeenCalledTimes(2);
    expect(exists).toHaveBeenCalledWith(
      {
        root: hostPathFromNative(identity.path),
        relative: input.relative,
      },
      {}
    );
  });

  it('resolves a client for each attached content state', async () => {
    const source = liveSource({
      kind: 'text',
      path: portablePath('README.md'),
      etag: 'etag-1',
      byteSize: 4,
      readonly: false,
      content: 'test',
      eol: 'lf',
      truncated: false,
    });
    const state = vi.fn(() => ({ asLiveSource: () => source }));
    const client = vi.fn(async () => ok({ files: { content: { state } } }));
    const controller = createEditorWireController({
      editorBuffer,
      runtimes: { client } as never,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });
    const key = {
      workspaceId: identity.workspaceId,
      relative: portablePath('README.md'),
    };
    const topic = encodeTopic(editorContract.content.states.content.id, key);

    const lease = controller.acquireLive(topic);
    await expect(lease?.ready()).resolves.toBe(source);
    expect(state).toHaveBeenCalledWith(
      {
        root: hostPathFromNative(identity.path),
        relative: key.relative,
      },
      'content'
    );

    await lease?.release();
  });

  it('passes the downloaded byte stream through', async () => {
    const chunks = async function* () {
      yield new Uint8Array([1, 2, 3]);
    };
    const readBytes = vi.fn(async () =>
      ok({
        meta: {
          name: 'image.png',
          mimeType: 'image/png',
          truncated: false,
          totalSize: 3,
          etag: 'etag-1',
        },
        chunks,
      })
    );
    const controller = createEditorWireController({
      editorBuffer,
      runtimes: {
        client: async () => ok({ files: { fs: { readBytes } } }),
      } as never,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });

    const result = await controller.call('fs.readBytes', {
      workspaceId: identity.workspaceId,
      relative: portablePath('image.png'),
    });

    expect(isDownloadFileOpenResult(result)).toBe(true);
    if (!isDownloadFileOpenResult(result)) throw new Error('Expected a download source');
    for await (const _chunk of result.data.source as AsyncIterable<Uint8Array>) {
      // Consume the source.
    }
  });

  it('returns RuntimeResolveError from fallible file procedures and mutations', async () => {
    const resolveError: RuntimeResolveError = {
      type: 'host-unavailable',
      host: LOCAL_HOST_REF,
      message: 'Runtime unavailable',
    };
    const controller = createEditorWireController({
      editorBuffer,
      runtimes: {
        client: async () => err(resolveError),
      } as never,
      workspaceIdentity: { resolve: vi.fn(async () => identity) },
    });
    const key = {
      workspaceId: identity.workspaceId,
      relative: portablePath('README.md'),
    };

    await expect(controller.call('fs.exists', key)).resolves.toEqual(err(resolveError));
    await expect(controller.call('fs.readBytes', key)).resolves.toEqual(err(resolveError));
    await expect(
      controller.call('content.write', {
        key,
        input: { content: 'updated', precondition: { kind: 'overwrite' } },
        mutationId: 'mutation-1',
      })
    ).resolves.toEqual(err(resolveError));
  });
});

function liveSource(data: unknown): LiveSource {
  return {
    snapshot: async () => ({ generation: 1, sequence: 0, timestamp: 0, data }),
    subscribe: () => () => {},
  };
}
