import { hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { formatAbsolute, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { FsError } from '@emdash/core/runtimes/files/api';
import { err, ok, type Result } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { WireError } from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';
import type { TerminalsRuntimeBroker, TerminalsWorkspaceIdentity } from '../api/runtime-adapter';
import { prepareTerminalAttachments } from './prepare-attachments';

const remoteHost = hostRef('remote', 'ssh-1');
const otherRemoteHost = hostRef('remote', 'ssh-2');
const identity = {
  projectId: 'project-1',
  workspaceId: 'workspace-1',
  host: remoteHost,
  path: '/repo/worktree',
} as const;

type UploadFile = {
  name: string;
  mimeType: string;
  size?: number;
  source: AsyncIterable<Uint8Array>;
};

describe('terminal attachment preparation', () => {
  it('routes local files once to the remote host and preserves batch order', async () => {
    const harness = createHarness();

    await expect(harness.call(['/home/user/first.txt', '/home/user/second.png'])).resolves.toEqual(
      ok({ paths: ['/tmp/first.txt', '/tmp/second.png'], pathStyle: 'posix' })
    );

    expect(harness.client).toHaveBeenCalledTimes(2);
    expect(harness.client).toHaveBeenNthCalledWith(1, remoteHost);
    expect(harness.client).toHaveBeenNthCalledWith(2, LOCAL_HOST_REF);
    expect(harness.requireAttached).toHaveBeenCalledWith(identity.projectId);
    expect(harness.events).toEqual([
      'read:/home/user/first.txt',
      'upload:first.txt',
      'read:/home/user/second.png',
      'upload:second.png',
    ]);
    expectDownloadsCancelled(harness.downloads);
  });

  it('formats returned Windows paths and reports their path style', async () => {
    const harness = createHarness();
    harness.uploadTemporary.mockResolvedValueOnce(
      ok({ path: hostPathFromNative('C:\\Temp\\attachment.txt') })
    );

    await expect(harness.call(['/home/user/attachment.txt'])).resolves.toEqual(
      ok({ paths: ['C:\\Temp\\attachment.txt'], pathStyle: 'win32' })
    );
  });

  it.each([
    {
      name: 'a missing workspace',
      resolved: null,
      expected: { type: 'missing-workspace', message: 'Workspace workspace-1 was not found' },
    },
    {
      name: 'a local workspace',
      resolved: { ...identity, host: LOCAL_HOST_REF },
      expected: {
        type: 'terminal-wire-error',
        message: 'Attachments already use local file paths',
      },
    },
    {
      name: 'a host mismatch',
      resolved: { ...identity, host: otherRemoteHost },
      expected: {
        type: 'terminal-wire-error',
        message: 'The workspace host changed before attaching files',
      },
    },
  ])('rejects $name before reading local files', async ({ resolved, expected }) => {
    const harness = createHarness();
    harness.resolve.mockResolvedValue(resolved);

    await expect(harness.call(['/home/user/attachment.txt'])).resolves.toEqual(err(expected));

    expect(harness.requireAttached).not.toHaveBeenCalled();
    expect(harness.client).not.toHaveBeenCalled();
    expect(harness.readBytes).not.toHaveBeenCalled();
  });

  it('requires an attached project before resolving runtime clients', async () => {
    const harness = createHarness();
    const attachmentError = {
      type: 'attachment-unavailable' as const,
      host: remoteHost,
      phase: 'waiting' as const,
    };
    harness.requireAttached.mockReturnValue(err(attachmentError));

    await expect(harness.call(['/home/user/attachment.txt'])).resolves.toEqual(
      err(attachmentError)
    );
    expect(harness.client).not.toHaveBeenCalled();
  });

  it('rejects truncated downloads, cancels them, and sends no upload', async () => {
    const harness = createHarness();
    const download = downloadFixture('growing.bin', { truncated: true });
    harness.readBytes.mockResolvedValueOnce(ok(download));

    await expect(harness.call(['/home/user/growing.bin'])).resolves.toEqual(
      err({
        type: 'terminal-wire-error',
        message: 'Attachment changed or is too large: /home/user/growing.bin',
      })
    );
    expect(harness.readBytes).toHaveBeenCalledWith(
      {
        path: hostPathFromNative('/home/user/growing.bin'),
        options: { maxBytes: 50 * 1024 * 1024 },
      },
      {}
    );
    expect(download.cancel).toHaveBeenCalledOnce();
    expect(harness.uploadTemporary).not.toHaveBeenCalled();
  });

  it('rolls back earlier uploads when a later upload fails', async () => {
    const harness = createHarness();
    const uploadError = { type: 'io' as const, path: '/tmp/second.txt', message: 'disk full' };
    harness.uploadTemporary
      .mockResolvedValueOnce(ok({ path: hostPathFromNative('/tmp/first.txt') }))
      .mockResolvedValueOnce(err(uploadError));

    await expect(harness.call(['/home/user/first.txt', '/home/user/second.txt'])).resolves.toEqual(
      err(uploadError)
    );

    expect(harness.deleteTemporary).toHaveBeenCalledOnce();
    expect(harness.deleteTemporary).toHaveBeenCalledWith({
      path: hostPathFromNative('/tmp/first.txt'),
    });
    expectDownloadsCancelled(harness.downloads);
  });

  it('rolls back earlier uploads when a later upload throws', async () => {
    const harness = createHarness();
    harness.uploadTemporary
      .mockResolvedValueOnce(ok({ path: hostPathFromNative('/tmp/first.txt') }))
      .mockRejectedValueOnce(new Error('connection closed'));

    await expect(harness.call(['/home/user/first.txt', '/home/user/second.txt'])).resolves.toEqual(
      err({
        type: 'terminal-wire-error',
        message: 'Failed to prepare terminal attachments: connection closed',
      })
    );

    expect(harness.deleteTemporary).toHaveBeenCalledWith({
      path: hostPathFromNative('/tmp/first.txt'),
    });
    expectDownloadsCancelled(harness.downloads);
  });

  it('rolls back and propagates cancellation during an upload', async () => {
    const harness = createHarness();
    const abort = new AbortController();
    harness.uploadTemporary
      .mockResolvedValueOnce(ok({ path: hostPathFromNative('/tmp/first.txt') }))
      .mockImplementationOnce(async (_input: undefined, _file: UploadFile, options) => {
        abort.abort();
        options.signal?.throwIfAborted();
        throw new Error('unreachable');
      });

    await expect(
      harness.call(['/home/user/first.txt', '/home/user/second.txt'], abort.signal)
    ).rejects.toMatchObject({ name: 'AbortError' });

    expect(harness.deleteTemporary).toHaveBeenCalledWith({
      path: hostPathFromNative('/tmp/first.txt'),
    });
    expectDownloadsCancelled(harness.downloads);
  });

  it('rolls back every upload when the workspace identity changes', async () => {
    const harness = createHarness();
    harness.resolve
      .mockResolvedValueOnce(identity)
      .mockResolvedValueOnce({ ...identity, path: '/repo/moved-worktree' });

    await expect(harness.call(['/home/user/first.txt', '/home/user/second.txt'])).resolves.toEqual(
      err({
        type: 'terminal-wire-error',
        message: 'The workspace changed while attaching files',
      })
    );

    expect(harness.deleteTemporary).toHaveBeenCalledTimes(2);
    expect(harness.deleteTemporary).toHaveBeenNthCalledWith(1, {
      path: hostPathFromNative('/tmp/first.txt'),
    });
    expect(harness.deleteTemporary).toHaveBeenNthCalledWith(2, {
      path: hostPathFromNative('/tmp/second.txt'),
    });
  });

  it('rolls back when cancellation happens during the final identity check', async () => {
    const harness = createHarness();
    const abort = new AbortController();
    harness.resolve.mockResolvedValueOnce(identity).mockImplementationOnce(async () => {
      abort.abort();
      return identity;
    });

    await expect(harness.call(['/home/user/attachment.txt'], abort.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });

    expect(harness.deleteTemporary).toHaveBeenCalledWith({
      path: hostPathFromNative('/tmp/attachment.txt'),
    });
  });

  it('reports an old workspace server without consuming input or leaking a path', async () => {
    const harness = createHarness();
    let sourceStarted = false;
    const download = downloadFixture('attachment.txt', {
      chunks: async function* () {
        sourceStarted = true;
        yield new Uint8Array([1]);
      },
    });
    harness.readBytes.mockResolvedValueOnce(ok(download));
    harness.uploadTemporary.mockRejectedValueOnce(
      new WireError('UNKNOWN_PROCEDURE', "Unknown procedure 'fs.uploadTemporary'")
    );

    await expect(harness.call(['/home/user/attachment.txt'])).resolves.toEqual(
      err({
        type: 'terminal-wire-error',
        message: 'Update the workspace server on this host to attach files.',
      })
    );

    expect(sourceStarted).toBe(false);
    expect(download.cancel).toHaveBeenCalledOnce();
    expect(harness.deleteTemporary).not.toHaveBeenCalled();
  });
});

function createHarness() {
  const events: string[] = [];
  const downloads: Array<ReturnType<typeof downloadFixture>> = [];
  const readBytes = vi.fn(async (input: { path: ReturnType<typeof hostPathFromNative> }) => {
    const path = formatAbsolute(input.path);
    events.push(`read:${path}`);
    const download = downloadFixture(input.path.segments.at(-1) ?? 'attachment');
    downloads.push(download);
    return ok(download);
  });
  const uploadTemporary = vi.fn<
    (
      input: undefined,
      file: UploadFile,
      options: { signal?: AbortSignal }
    ) => Promise<Result<{ path: HostAbsolutePath }, FsError>>
  >(async (_input: undefined, file: UploadFile, _options: { signal?: AbortSignal }) => {
    events.push(`upload:${file.name}`);
    for await (const _chunk of file.source) {
      // Consume the source as the real remote endpoint does.
    }
    return ok({ path: hostPathFromNative(`/tmp/${file.name}`) });
  });
  const deleteTemporary = vi.fn(async (input: { path: ReturnType<typeof hostPathFromNative> }) => {
    events.push(`delete:${formatAbsolute(input.path)}`);
    return ok(undefined);
  });
  const client = vi.fn(async () =>
    ok({ files: { fs: { readBytes, uploadTemporary, delete: deleteTemporary } } })
  );
  const resolve = vi.fn<(workspaceId: string) => Promise<TerminalsWorkspaceIdentity | null>>(
    async () => identity
  );
  // These fixtures implement only the collaborators exercised by attachment preparation.
  const requireAttached = vi.fn<ProjectAttachmentManager['requireAttached']>(() => ok({} as never));
  const options = {
    logger: noopLogger,
    projects: { requireAttached },
    runtimes: { client } as unknown as TerminalsRuntimeBroker,
    workspaceIdentity: { resolve },
  };

  return {
    events,
    downloads,
    readBytes,
    uploadTemporary,
    deleteTemporary,
    client,
    resolve,
    requireAttached,
    call: (localPaths: string[], signal?: AbortSignal) =>
      prepareTerminalAttachments(
        options,
        {
          workspaceId: identity.workspaceId,
          expectedHost: remoteHost,
          localPaths,
        },
        signal ? { signal } : {}
      ),
  };
}

function downloadFixture(
  name: string,
  options: {
    truncated?: boolean;
    chunks?: () => AsyncIterable<Uint8Array>;
  } = {}
) {
  const bytes = new Uint8Array(10);
  return {
    meta: {
      name,
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
      truncated: options.truncated ?? false,
      totalSize: bytes.byteLength,
      etag: 'etag',
    },
    chunks: options.chunks ?? (() => chunks(bytes)),
    cancel: vi.fn(),
  };
}

async function* chunks(...values: Uint8Array[]): AsyncIterable<Uint8Array> {
  yield* values;
}

function expectDownloadsCancelled(downloads: readonly ReturnType<typeof downloadFixture>[]): void {
  for (const download of downloads) {
    expect(download.cancel).toHaveBeenCalledOnce();
  }
}
