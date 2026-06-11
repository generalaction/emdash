import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import type { FileReadResult, FileStat, IFsService } from './types';

export class FsService implements IFsService {
  async read(filePath: string, options: { maxBytes?: number } = {}): Promise<FileReadResult> {
    const stat = await fs.stat(filePath);
    const maxBytes = options.maxBytes;
    if (maxBytes === undefined) {
      const content = await fs.readFile(filePath, 'utf8');
      return {
        content,
        truncated: false,
        totalSize: stat.size,
      };
    }

    const handle = await fs.open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(maxBytes + 1);
      const { bytesRead } = await handle.read(buffer, 0, maxBytes + 1, 0);
      const truncated = bytesRead > maxBytes;
      const slice = buffer.subarray(0, truncated ? maxBytes : bytesRead);
      return {
        content: slice.toString('utf8'),
        truncated,
        totalSize: stat.size,
      };
    } finally {
      await handle.close();
    }
  }

  async stat(filePath: string): Promise<FileStat | null> {
    let stat;
    try {
      stat = await fs.lstat(filePath);
    } catch {
      return null;
    }
    if (!stat.isFile() && !stat.isDirectory()) return null;
    return {
      type: stat.isDirectory() ? 'dir' : 'file',
      size: stat.size,
      mtimeMs: stat.mtimeMs,
    };
  }

  async remove(filePath: string, options: { recursive?: boolean } = {}): Promise<void> {
    await fs.rm(filePath, { force: true, recursive: options.recursive ?? false });
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath, constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }
}
