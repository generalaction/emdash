import { promises as fs } from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { FileSystemError, FileSystemErrorCodes, type FileEntry } from '@main/core/fs/types';
import type { WorktreeHost } from './worktree-host';

type PathApi = Pick<typeof path, 'isAbsolute' | 'relative'>;

export function isPathInsideRoot(
  child: string,
  parent: string,
  options: { pathApi?: PathApi } = {}
): boolean {
  const pathApi = options.pathApi ?? path;
  const rel = pathApi.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !pathApi.isAbsolute(rel));
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export class LocalWorktreeHost implements WorktreeHost {
  private constructor(private readonly roots: string[]) {}

  static async create(args: { allowedRoots: string[] }): Promise<LocalWorktreeHost> {
    if (args.allowedRoots.length === 0) {
      throw new FileSystemError(
        'At least one allowed root is required',
        FileSystemErrorCodes.INVALID_PATH
      );
    }

    const roots = await Promise.all(
      args.allowedRoots.map(async (root) => {
        const resolved = path.resolve(root);
        if (!path.isAbsolute(resolved)) {
          throw new FileSystemError(
            `Expected absolute allowed root: ${root}`,
            FileSystemErrorCodes.INVALID_PATH,
            root
          );
        }
        return fs.realpath(resolved);
      })
    );

    return new LocalWorktreeHost(roots);
  }

  private assertAbsolute(input: string): string {
    const resolved = path.resolve(input);
    if (!path.isAbsolute(input)) {
      throw new FileSystemError(
        `Expected absolute path: ${input}`,
        FileSystemErrorCodes.INVALID_PATH,
        input
      );
    }
    return resolved;
  }

  private assertInsideAllowedRoots(resolved: string, originalPath: string): void {
    if (!this.roots.some((root) => isPathInsideRoot(resolved, root))) {
      throw new FileSystemError(
        `Path outside allowed roots: ${originalPath}`,
        FileSystemErrorCodes.PATH_ESCAPE,
        originalPath
      );
    }
  }

  private async validateExisting(input: string): Promise<string> {
    const resolved = this.assertAbsolute(input);
    const real = await fs.realpath(resolved);
    this.assertInsideAllowedRoots(real, input);
    return real;
  }

  private async nearestExistingPath(resolved: string): Promise<{
    realAncestor: string;
    unresolvedSegments: string[];
  }> {
    const unresolvedSegments: string[] = [];
    let current = resolved;

    while (true) {
      try {
        return {
          realAncestor: await fs.realpath(current),
          unresolvedSegments: unresolvedSegments.reverse(),
        };
      } catch (error) {
        if (!isNotFound(error)) throw error;
        const parent = path.dirname(current);
        if (parent === current) throw error;
        unresolvedSegments.push(path.basename(current));
        current = parent;
      }
    }
  }

  private async validateTarget(input: string): Promise<string> {
    const resolved = this.assertAbsolute(input);
    try {
      return await this.validateExisting(resolved);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    const { realAncestor, unresolvedSegments } = await this.nearestExistingPath(resolved);
    this.assertInsideAllowedRoots(realAncestor, input);
    const target = path.join(realAncestor, ...unresolvedSegments);
    this.assertInsideAllowedRoots(target, input);
    return target;
  }

  async existsAbsolute(filePath: string): Promise<boolean> {
    try {
      await this.validateExisting(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async mkdirAbsolute(dirPath: string, options?: { recursive?: boolean }): Promise<void> {
    const target = await this.validateTarget(dirPath);
    await fs.mkdir(target, { recursive: options?.recursive ?? false });
  }

  async removeAbsolute(
    filePath: string,
    options?: { recursive?: boolean }
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const target = await this.validateExisting(filePath);
      await fs.rm(target, { recursive: options?.recursive ?? false, force: false });
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async realPathAbsolute(filePath: string): Promise<string> {
    return this.validateExisting(filePath);
  }

  async globAbsolute(pattern: string, options: { cwd: string; dot?: boolean }): Promise<string[]> {
    const cwd = await this.validateExisting(options.cwd);
    return glob(pattern, { cwd, dot: options.dot ?? false, absolute: false });
  }

  async copyFileAbsolute(src: string, dest: string): Promise<void> {
    const safeSrc = await this.validateExisting(src);
    const safeDest = await this.validateTarget(dest);
    await fs.copyFile(safeSrc, safeDest);
  }

  async statAbsolute(filePath: string): Promise<FileEntry | null> {
    try {
      const fullPath = await this.validateExisting(filePath);
      const stat = await fs.stat(fullPath);
      return {
        path: fullPath,
        type: stat.isDirectory() ? 'dir' : 'file',
        size: stat.size,
        mtime: stat.mtime,
        ctime: stat.ctime,
        mode: stat.mode,
      };
    } catch {
      return null;
    }
  }
}
