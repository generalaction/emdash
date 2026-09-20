import { hostRefEquals, isLocalHostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import { formatAbsolute, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import { MAX_TEMPORARY_UPLOAD_BYTES, type FsError } from '@emdash/core/runtimes/files/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { WireError, type CallMeta } from '@emdash/wire/rpc';
import type { ProjectAttachmentError } from '@core/features/projects/api';
import type { ProjectAttachmentManager } from '@core/features/projects/api/node/project-attachment-manager';
import type {
  TerminalPrepareAttachmentsInput,
  TerminalPrepareAttachmentsResult,
  TerminalSliceContextError,
} from '@core/features/terminals/api';
import type {
  TerminalsHostRuntimesClient,
  TerminalsRuntimeBroker,
  TerminalsRuntimeResolveError,
  TerminalsWorkspaceIdentity,
  TerminalsWorkspaceIdentityResolver,
} from '@core/features/terminals/api/runtime-adapter';
import { hostPathFromNative } from '@core/primitives/desktop-runtime/api';

type PrepareAttachmentsError =
  | FsError
  | ProjectAttachmentError
  | TerminalsRuntimeResolveError
  | TerminalSliceContextError;

type PrepareTerminalAttachmentsOptions = Readonly<{
  logger: Logger;
  projects: Pick<ProjectAttachmentManager, 'requireAttached'>;
  runtimes: TerminalsRuntimeBroker;
  workspaceIdentity: TerminalsWorkspaceIdentityResolver;
}>;

export async function prepareTerminalAttachments(
  options: PrepareTerminalAttachmentsOptions,
  input: TerminalPrepareAttachmentsInput,
  meta: CallMeta
): Promise<Result<TerminalPrepareAttachmentsResult, PrepareAttachmentsError>> {
  const initialIdentity = await options.workspaceIdentity.resolve(input.workspaceId);
  if (!initialIdentity) {
    return err(contextError('missing-workspace', `Workspace ${input.workspaceId} was not found`));
  }
  if (isLocalHostRef(initialIdentity.host)) {
    return err(contextError('terminal-wire-error', 'Attachments already use local file paths'));
  }
  if (!hostRefEquals(initialIdentity.host, input.expectedHost)) {
    return err(
      contextError('terminal-wire-error', 'The workspace host changed before attaching files')
    );
  }

  const attached = options.projects.requireAttached(initialIdentity.projectId);
  if (!attached.success) return attached;

  meta.signal?.throwIfAborted();
  const targetRuntime = await options.runtimes.client(initialIdentity.host);
  if (!targetRuntime.success) return targetRuntime;

  meta.signal?.throwIfAborted();
  const localRuntime = await options.runtimes.client(LOCAL_HOST_REF);
  if (!localRuntime.success) return localRuntime;

  return transferAttachments(
    options,
    input,
    meta,
    initialIdentity,
    localRuntime.data,
    targetRuntime.data
  );
}

async function transferAttachments(
  options: PrepareTerminalAttachmentsOptions,
  input: TerminalPrepareAttachmentsInput,
  meta: CallMeta,
  initialIdentity: TerminalsWorkspaceIdentity,
  localRuntime: TerminalsHostRuntimesClient,
  targetRuntime: TerminalsHostRuntimesClient
): Promise<Result<TerminalPrepareAttachmentsResult, PrepareAttachmentsError>> {
  const uploadedPaths: HostAbsolutePath[] = [];
  let completed = false;

  try {
    for (const localPath of input.localPaths) {
      meta.signal?.throwIfAborted();
      const parsedPath = parseLocalPath(localPath);
      if (!parsedPath.success) return parsedPath;

      const download = await localRuntime.files.fs.readBytes(
        {
          path: parsedPath.data,
          options: { maxBytes: MAX_TEMPORARY_UPLOAD_BYTES },
        },
        callOptions(meta)
      );
      if (!download.success) return download;

      try {
        if (download.data.meta.truncated) {
          return err(
            contextError('terminal-wire-error', `Attachment changed or is too large: ${localPath}`)
          );
        }

        meta.signal?.throwIfAborted();
        const upload = await uploadTemporary(targetRuntime, download.data, meta);
        if (!upload.success) return upload;
        uploadedPaths.push(upload.data.path);
        meta.signal?.throwIfAborted();
      } finally {
        cancelDownload(options.logger, download.data, localPath);
      }
    }

    const finalIdentity = await options.workspaceIdentity.resolve(input.workspaceId);
    meta.signal?.throwIfAborted();
    if (!finalIdentity) {
      return err(contextError('missing-workspace', `Workspace ${input.workspaceId} was not found`));
    }
    if (!sameWorkspaceIdentity(initialIdentity, finalIdentity)) {
      return err(
        contextError('terminal-wire-error', 'The workspace changed while attaching files')
      );
    }

    const pathStyle = uploadedPaths[0].root.kind === 'posix' ? 'posix' : 'win32';
    const separator = pathStyle === 'posix' ? '/' : '\\';
    const result: TerminalPrepareAttachmentsResult = {
      paths: uploadedPaths.map((path) => formatAbsolute(path, { separator })),
      pathStyle,
    };
    completed = true;
    return ok(result);
  } catch (error) {
    if (meta.signal?.aborted) meta.signal.throwIfAborted();
    return err(
      contextError(
        'terminal-wire-error',
        `Failed to prepare terminal attachments: ${errorMessage(error)}`
      )
    );
  } finally {
    if (!completed) {
      await deleteUploadedFiles(options.logger, targetRuntime, uploadedPaths);
    }
  }
}

async function uploadTemporary(
  targetRuntime: TerminalsHostRuntimesClient,
  download: {
    meta: { name: string; mimeType: string; size?: number };
    chunks(): AsyncIterable<Uint8Array>;
  },
  meta: CallMeta
): Promise<Result<{ path: HostAbsolutePath }, PrepareAttachmentsError>> {
  try {
    return await targetRuntime.files.fs.uploadTemporary(
      undefined,
      {
        name: download.meta.name,
        mimeType: download.meta.mimeType,
        size: download.meta.size,
        source: download.chunks(),
      },
      callOptions(meta)
    );
  } catch (error) {
    if (error instanceof WireError && error.code === 'UNKNOWN_PROCEDURE') {
      return err(
        contextError(
          'terminal-wire-error',
          'Update the workspace server on this host to attach files.'
        )
      );
    }
    throw error;
  }
}

function parseLocalPath(path: string): Result<HostAbsolutePath, FsError> {
  try {
    return ok(hostPathFromNative(path));
  } catch (error) {
    return err({ type: 'invalid-path', path, message: errorMessage(error) });
  }
}

async function deleteUploadedFiles(
  logger: Logger,
  targetRuntime: TerminalsHostRuntimesClient,
  paths: readonly HostAbsolutePath[]
): Promise<void> {
  for (const path of paths) {
    try {
      const deleted = await targetRuntime.files.fs.delete({ path });
      if (!deleted.success) {
        logger.warn('Failed to delete a temporary terminal attachment', {
          path: formatAbsolute(path),
          error: deleted.error,
        });
      }
    } catch (error) {
      logger.warn('Failed to delete a temporary terminal attachment', {
        path: formatAbsolute(path),
        error: errorMessage(error),
      });
    }
  }
}

function cancelDownload(logger: Logger, download: { cancel(): void }, localPath: string): void {
  try {
    download.cancel();
  } catch (error) {
    logger.warn('Failed to cancel a local terminal attachment download', {
      path: localPath,
      error: errorMessage(error),
    });
  }
}

function sameWorkspaceIdentity(
  initial: TerminalsWorkspaceIdentity,
  current: TerminalsWorkspaceIdentity
): boolean {
  return (
    initial.workspaceId === current.workspaceId &&
    initial.projectId === current.projectId &&
    initial.path === current.path &&
    hostRefEquals(initial.host, current.host)
  );
}

function contextError(
  type: TerminalSliceContextError['type'],
  message: string
): TerminalSliceContextError {
  return { type, message };
}

function callOptions(meta: CallMeta): { signal?: AbortSignal } {
  return meta.signal ? { signal: meta.signal } : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
