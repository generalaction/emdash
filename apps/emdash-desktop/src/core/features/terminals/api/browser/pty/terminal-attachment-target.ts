import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  type AttachmentRef,
} from '@emdash/core/services/attachments/api';
import type { UploadFileValue } from '@emdash/wire/rpc';
import type { NodePlatform } from '@core/primitives/desktop-host/api/host-contract';
import { log } from '@core/primitives/logging/browser/logger';
import type {
  LocalTerminalFile,
  PreparedTerminalFile,
} from '@core/services/attachments/api/terminal-files';
import { resolveDroppedFile } from './terminal-image-injection';
import { isHeicLikeFile, isUnstableDropPath } from './terminal-image-paths';

type AttachmentResult<T> =
  | { success: true; data: T }
  | { success: false; error: { type: string; message?: string } };
export interface TerminalAttachmentClient {
  upload(file: UploadFileValue, signal: AbortSignal): Promise<AttachmentResult<AttachmentRef>>;
  prepareLocalFiles(
    sources: LocalTerminalFile[],
    signal: AbortSignal
  ): Promise<AttachmentResult<PreparedTerminalFile[]>>;
  delete(id: string): Promise<AttachmentResult<void>>;
}
export interface PreparedTerminalAttachments {
  paths: string[];
  platform: NodePlatform;
  discard(): Promise<void>;
}
export interface TerminalAttachmentTarget {
  prepareFiles(
    files: File[],
    signal: AbortSignal,
    snapshot?: boolean
  ): Promise<PreparedTerminalAttachments>;
  prepareLocalSnapshots(paths: string[], signal: AbortSignal): Promise<PreparedTerminalAttachments>;
}

/** The client captures the owner; batches keep order and roll back only managed copies. */
export function createTerminalAttachmentTarget(
  client: TerminalAttachmentClient
): TerminalAttachmentTarget {
  const prepareLocalFile = async (source: LocalTerminalFile, signal: AbortSignal) => {
    signal.throwIfAborted();
    const result = await client.prepareLocalFiles([source], signal);
    if (!result.success) throw new Error(result.error.message ?? result.error.type);
    return result.data;
  };
  const batch = async <T>(
    items: T[],
    signal: AbortSignal,
    send: (item: T, signal: AbortSignal) => Promise<PreparedTerminalFile[]>
  ): Promise<PreparedTerminalAttachments> => {
    if (!items.length || items.length > MAX_ATTACHMENT_FILES)
      throw new Error(`Attach between 1 and ${MAX_ATTACHMENT_FILES} files at a time.`);
    const prepared: PreparedTerminalFile[] = [];
    const discard = async () => {
      for (const ref of prepared.splice(0)) {
        if (ref.kind !== 'attachment') continue;
        try {
          // Rollback must remain usable after the upload's signal is aborted.
          const result = await client.delete(ref.id);
          if (!result.success) log.warn('Attachment rollback failed', { error: result.error });
        } catch (error) {
          log.warn('Attachment rollback failed', { error });
        }
      }
    };
    try {
      for (const item of items) {
        signal.throwIfAborted();
        prepared.push(...(await send(item, signal)));
        signal.throwIfAborted();
      }
      return {
        paths: prepared.map((ref) => ref.targetPath),
        platform: prepared[0].pathStyle === 'win32' ? 'win32' : 'linux',
        discard,
      };
    } catch (error) {
      await discard();
      throw error;
    }
  };
  return {
    prepareLocalSnapshots: (paths, signal) =>
      batch(paths, signal, (path) => prepareLocalFile({ path, snapshot: true }, signal)),
    prepareFiles: (files, signal, snapshot = false) =>
      batch(files, signal, async (file) => {
        const path =
          typeof window === 'undefined'
            ? ''
            : (window.electronAPI?.getPathForFile(file)?.trim() ?? '');
        if (path && !isUnstableDropPath(path)) {
          return prepareLocalFile({ path, name: file.name, mimeType: file.type, snapshot }, signal);
        }
        if (isHeicLikeFile(file)) {
          const converted = await resolveDroppedFile(file);
          if (!converted) throw new Error('The image could not be converted.');
          return prepareLocalFile({ path: converted, snapshot: true }, signal);
        }
        if (file.size > MAX_ATTACHMENT_BYTES)
          throw new Error('Attachment exceeds the 50 MB upload limit.');
        const result = await client.upload(
          {
            name: file.name,
            mimeType: file.type || 'application/octet-stream',
            size: file.size,
            source: file.stream(),
          },
          signal
        );
        if (!result.success) throw new Error(result.error.message ?? result.error.type);
        return [{ kind: 'attachment', ...result.data }];
      }),
  };
}
