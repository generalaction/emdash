import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import {
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_FILES,
  type AttachmentError,
  type AttachmentRef,
} from '@emdash/core/services/attachments/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import type { UploadFileValue } from '@emdash/wire/rpc';
import type { LocalTerminalFile, PreparedTerminalFile } from '../api/terminal-files';

export type PreparedLocalSource = {
  name: string;
  mimeType: string;
  dispose(): Promise<void>;
} & ({ kind: 'path'; path: string; snapshot: boolean } | { kind: 'bytes'; bytes: Uint8Array });
export type TerminalFileSources = {
  prepare(source: LocalTerminalFile, signal?: AbortSignal): Promise<PreparedLocalSource>;
};

/** Main owns local IO; the owning domain resolves the host and supplies its upload port. */
export async function prepareTerminalFiles<E>(options: {
  host: HostRef;
  sources: LocalTerminalFile[];
  localFiles: TerminalFileSources;
  upload(file: UploadFileValue): Promise<Result<AttachmentRef, E>>;
  remove(id: string): Promise<Result<void, E>>;
  signal?: AbortSignal;
  logger: Logger;
}): Promise<Result<PreparedTerminalFile[], E | AttachmentError>> {
  const prepared: PreparedTerminalFile[] = [];
  const { signal } = options;
  let completed = false;
  try {
    if (!options.sources.length || options.sources.length > MAX_ATTACHMENT_FILES)
      throw new Error(`Attach between 1 and ${MAX_ATTACHMENT_FILES} files at a time.`);
    for (const input of options.sources) {
      signal?.throwIfAborted();
      if (!isAbsolute(input.path)) throw new Error('Expected an absolute desktop file path');
      const source = await options.localFiles.prepare(input, signal);
      try {
        signal?.throwIfAborted();
        let file: UploadFileValue;
        let close: (() => Promise<void>) | undefined;
        try {
          if (source.kind === 'path') {
            const handle = await open(source.path, 'r');
            close = () => handle.close();
            const stat = await handle.stat();
            if (!stat.isFile()) throw new Error('Only files can be attached');
            if (isLocalHostRef(options.host) && !source.snapshot) {
              prepared.push({
                kind: 'reference',
                targetPath: source.path,
                pathStyle: process.platform === 'win32' ? 'win32' : 'posix',
              });
              continue;
            }
            if (stat.size > MAX_ATTACHMENT_BYTES)
              throw new Error('Attachment exceeds the 50 MB upload limit.');
            // Wire cancels the transfer; the finally below closes the source. Passing
            // a signal to an unread Node stream can emit an unhandled AbortError
            // before the remote consumer has granted its first byte credit.
            const stream = handle.createReadStream({ autoClose: false });
            close = async () => {
              stream.destroy();
              await handle.close();
            };
            file = {
              name: source.name,
              mimeType: source.mimeType,
              size: stat.size,
              source: stream,
            };
          } else {
            if (source.bytes.byteLength > MAX_ATTACHMENT_BYTES)
              throw new Error('Attachment exceeds the 50 MB upload limit.');
            file = {
              name: source.name,
              mimeType: source.mimeType,
              size: source.bytes.byteLength,
              source: (async function* () {
                yield source.bytes;
              })(),
            };
          }
          const result = await options.upload(file);
          if (!result.success) return result;
          prepared.push({ kind: 'attachment', ...result.data });
        } finally {
          await close?.();
        }
      } finally {
        await source
          .dispose()
          .catch((error) => options.logger.warn('Temporary attachment cleanup failed', { error }));
      }
      signal?.throwIfAborted();
    }
    signal?.throwIfAborted();
    completed = true;
    return ok(prepared);
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted();
    return err({
      type: 'storage-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    if (!completed)
      for (const file of prepared) {
        if (file.kind !== 'attachment') continue;
        try {
          const result = await options.remove(file.id);
          if (!result.success)
            options.logger.warn('Attachment rollback failed', { error: result.error });
        } catch (error) {
          options.logger.warn('Attachment rollback failed', { error });
        }
      }
  }
}
