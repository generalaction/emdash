import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, readdir, rename, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { WireFile } from '@emdash/wire/rpc';
import { parseAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import { MAX_TEMPORARY_UPLOAD_BYTES, type FsError } from '#runtimes/files/api';
import { toFsError } from '#runtimes/files/node/api/errors';

const TEMPORARY_UPLOAD_RETENTION_MS = 24 * 60 * 60 * 1_000;
const UPLOAD_FILE_MODE = 0o600;
const UPLOAD_DIRECTORY_MODE = 0o700;
const UPLOAD_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.partial|-upload(?:\.[A-Za-z0-9][A-Za-z0-9._-]{0,15})?)$/u;
const ORDINARY_EXTENSION_PATTERN = /^\.[A-Za-z0-9][A-Za-z0-9._-]{0,15}$/u;

export class TemporaryUploadStore {
  constructor(private readonly directory = defaultUploadDirectory()) {}

  async upload(
    file: WireFile,
    signal?: AbortSignal
  ): Promise<Result<{ path: HostAbsolutePath }, FsError>> {
    const uploadId = randomUUID();
    const partialPath = path.join(this.directory, `${uploadId}.partial`);
    const finalPath = path.join(this.directory, `${uploadId}-upload${safeExtension(file.name)}`);
    const parsedFinalPath = parseAbsolute(finalPath, {
      profile: {
        style: path.sep === '\\' ? 'win32' : 'posix',
        unicodeNormalization: 'preserve',
      },
    });
    if (!parsedFinalPath.success) {
      return err({
        type: 'invalid-path',
        path: finalPath,
        message: parsedFinalPath.error.message,
      });
    }

    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let finalCreated = false;
    let completed = false;
    let cancelled = false;
    const cancelUpload = () => {
      if (cancelled) return;
      cancelled = true;
      file.cancel();
    };

    try {
      await this.prepareDirectory();
      signal?.throwIfAborted();
      handle = await open(
        partialPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        UPLOAD_FILE_MODE
      );
      signal?.addEventListener('abort', cancelUpload, { once: true });
      signal?.throwIfAborted();

      let bytesWritten = 0;
      for await (const chunk of file.stream()) {
        signal?.throwIfAborted();
        bytesWritten += chunk.byteLength;
        if (bytesWritten > MAX_TEMPORARY_UPLOAD_BYTES) {
          throw new Error(`Temporary upload exceeded maximum ${MAX_TEMPORARY_UPLOAD_BYTES} bytes`);
        }
        await writeAll(handle, chunk);
      }
      signal?.throwIfAborted();
      await handle.chmod(UPLOAD_FILE_MODE);
      await handle.close();
      handle = undefined;
      signal?.throwIfAborted();
      await rename(partialPath, finalPath);
      finalCreated = true;
      signal?.throwIfAborted();
      completed = true;
      return ok({ path: parsedFinalPath.data });
    } catch (error) {
      cancelUpload();
      return err(toFsError(error, finalPath));
    } finally {
      signal?.removeEventListener('abort', cancelUpload);
      await handle?.close().catch(() => undefined);
      if (!completed) {
        await unlink(partialPath).catch(() => undefined);
        if (finalCreated) await unlink(finalPath).catch(() => undefined);
      }
    }
  }

  private async prepareDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: UPLOAD_DIRECTORY_MODE });
    const metadata = await lstat(this.directory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Temporary upload namespace is not a directory: ${this.directory}`);
    }
    const uid = process.getuid?.();
    if (uid !== undefined && metadata.uid !== uid) {
      throw new Error(`Temporary upload namespace has a different owner: ${this.directory}`);
    }
    await chmod(this.directory, UPLOAD_DIRECTORY_MODE);
    await this.removeExpiredUploads(uid);
  }

  private async removeExpiredUploads(uid: number | undefined): Promise<void> {
    const expirationTime = Date.now() - TEMPORARY_UPLOAD_RETENTION_MS;
    const entries = await readdir(this.directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile() || !UPLOAD_NAME_PATTERN.test(entry.name)) return;
        const candidate = path.join(this.directory, entry.name);
        const metadata = await lstat(candidate).catch(() => undefined);
        if (!metadata?.isFile() || metadata.isSymbolicLink()) return;
        if (uid !== undefined && metadata.uid !== uid) return;
        if (metadata.mtimeMs >= expirationTime) return;
        await unlink(candidate).catch(() => undefined);
      })
    );
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array
): Promise<void> {
  let offset = 0;
  while (offset < chunk.byteLength) {
    const written = await handle.write(chunk, offset, chunk.byteLength - offset);
    if (written.bytesWritten === 0) throw new Error('Temporary upload write made no progress');
    offset += written.bytesWritten;
  }
}

function safeExtension(fileName: string): string {
  const extension = path.extname(path.basename(fileName));
  return ORDINARY_EXTENSION_PATTERN.test(extension) ? extension : '';
}

function defaultUploadDirectory(): string {
  const owner = process.getuid?.() ?? 'user';
  return path.join(tmpdir(), `emdash-temporary-uploads-v1-${owner}`);
}
