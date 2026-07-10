import { constants } from 'node:fs';
import { access, open } from 'node:fs/promises';
import type { FileContentModel, FsError } from '@emdash/core/files';
import { toFsError } from '../api/errors';
import { etagForStat, mimeTypeForPath, normalizeMaxBytes } from '../fs/metadata';
import type { RootPathPolicy } from '../fs/path-policy';

const BINARY_SAMPLE_BYTES = 8 * 1024;

export class ContentReader {
  constructor(
    private readonly paths: RootPathPolicy,
    private readonly maxBytes?: number
  ) {}

  async read(entryPath: string): Promise<FileContentModel> {
    const resolved = await this.paths.resolveFollowed(entryPath);
    if (!resolved.success) return unavailable(entryPath, resolved.error);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const handle = await open(
          resolved.data.realPath,
          constants.O_RDONLY | constants.O_NONBLOCK
        );
        try {
          const before = await handle.stat();
          if (before.isDirectory()) {
            return unavailable(entryPath, { type: 'is-a-directory', path: entryPath });
          }
          if (!before.isFile()) {
            return unavailable(entryPath, {
              type: 'invalid-path',
              path: entryPath,
              message: 'Path is not a regular file',
            });
          }
          const limit = normalizeMaxBytes(this.maxBytes);
          const readSize = Math.min(before.size, limit);
          const buffer = Buffer.alloc(readSize);
          const { bytesRead } =
            readSize === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, readSize, 0);
          const bytes = buffer.subarray(0, bytesRead);
          const after = await handle.stat();
          if (etagForStat(before) !== etagForStat(after)) {
            if (attempt === 0) continue;
            return unavailable(entryPath, {
              type: 'io',
              path: entryPath,
              message: 'File changed repeatedly while it was being read',
            });
          }

          const base = {
            path: entryPath,
            etag: etagForStat(after),
            byteSize: after.size,
            readonly: !(await isWritable(resolved.data.realPath)),
          };
          if (isBinary(bytes.subarray(0, BINARY_SAMPLE_BYTES))) {
            return {
              ...base,
              kind: 'binary',
              ...(mimeTypeForPath(entryPath) ? { mimeType: mimeTypeForPath(entryPath) } : {}),
            };
          }
          const content = bytes.toString('utf8');
          return {
            ...base,
            kind: 'text',
            content,
            eol: content.includes('\r\n') ? 'crlf' : 'lf',
            truncated: after.size > bytesRead,
          };
        } finally {
          await handle.close();
        }
      } catch (error) {
        return unavailable(entryPath, toFsError(error, entryPath));
      }
    }
    throw new Error('ContentReader exhausted its read attempts');
  }
}

function isBinary(sample: Uint8Array): boolean {
  if (sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf) {
    return false;
  }
  return sample.includes(0);
}

async function isWritable(filePath: string): Promise<boolean> {
  try {
    await access(filePath, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function unavailable(path: string, error: FsError): FileContentModel {
  return { kind: 'unavailable', path, error };
}
