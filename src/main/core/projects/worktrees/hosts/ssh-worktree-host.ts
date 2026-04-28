import path from 'node:path';
import {
  FileSystemError,
  FileSystemErrorCodes,
  type FileEntry,
  type FileSystemProvider,
} from '@main/core/fs/types';
import type { WorktreeHost } from './worktree-host';

type SshWorktreeFs = Pick<
  FileSystemProvider,
  'exists' | 'mkdir' | 'remove' | 'realPath' | 'glob' | 'copyFile' | 'stat'
>;

export class SshWorktreeHost implements WorktreeHost {
  constructor(private readonly fs: SshWorktreeFs) {}

  private validateAbsolute(input: string): string {
    if (!path.posix.isAbsolute(input)) {
      throw new FileSystemError(
        `Expected absolute POSIX path: ${input}`,
        FileSystemErrorCodes.INVALID_PATH,
        input
      );
    }
    return input;
  }

  async existsAbsolute(filePath: string): Promise<boolean> {
    return this.fs.exists(this.validateAbsolute(filePath));
  }

  async mkdirAbsolute(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    return this.fs.mkdir(this.validateAbsolute(dirPath), options);
  }

  async removeAbsolute(
    filePath: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    return this.fs.remove(this.validateAbsolute(filePath), options);
  }

  async realPathAbsolute(filePath: string): Promise<string> {
    return this.fs.realPath(this.validateAbsolute(filePath));
  }

  async globAbsolute(pattern: string, options: { cwd: string; dot?: boolean }): Promise<string[]> {
    return this.fs.glob(pattern, {
      ...options,
      cwd: this.validateAbsolute(options.cwd),
    });
  }

  async copyFileAbsolute(src: string, dest: string): Promise<void> {
    return this.fs.copyFile(this.validateAbsolute(src), this.validateAbsolute(dest));
  }

  async statAbsolute(filePath: string): Promise<FileEntry | null> {
    return this.fs.stat(this.validateAbsolute(filePath));
  }
}
