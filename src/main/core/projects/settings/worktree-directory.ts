import fs from 'node:fs';
import path from 'node:path';
import type { FileSystemProvider } from '@main/core/fs/types';

export type WorktreeDirectoryFs = Pick<FileSystemProvider, 'mkdir' | 'realPath'>;

type PathApi = Pick<typeof path, 'isAbsolute' | 'join' | 'resolve'>;

export async function normalizeWorktreeDirectory(
  input: string,
  options: {
    projectPath: string;
    pathApi: PathApi;
    homeDirectory?: string;
    resolveHomeDirectory?: () => Promise<string>;
  }
): Promise<string> {
  const trimmed = input.trim();
  let normalized = trimmed;

  if (trimmed === '~' || trimmed.startsWith('~/')) {
    const resolvedHomeDirectory = options.resolveHomeDirectory
      ? (await options.resolveHomeDirectory()).trim()
      : undefined;
    const homeDirectory = options.homeDirectory ?? resolvedHomeDirectory;
    if (!homeDirectory) {
      throw new Error('Worktree directory cannot use "~" without a home directory resolver.');
    }
    normalized =
      trimmed === '~' ? homeDirectory : options.pathApi.join(homeDirectory, trimmed.slice(2));
  }

  if (options.pathApi.isAbsolute(normalized)) {
    return normalized;
  }
  return options.pathApi.resolve(options.projectPath, normalized);
}

export async function canonicalizeWorktreeDirectory(
  directory: string,
  fs: WorktreeDirectoryFs
): Promise<string> {
  await fs.mkdir(directory, { recursive: true });
  return fs.realPath(directory);
}

export const defaultLocalWorktreeFs: WorktreeDirectoryFs = {
  mkdir: async (p, options) => {
    await fs.promises.mkdir(p, options);
  },
  realPath: async (p) => fs.promises.realpath(p),
};

export async function resolveAndValidateWorktreeDirectory(
  input: string | undefined,
  options: {
    projectPath: string;
    pathApi: Pick<typeof path, 'isAbsolute' | 'join' | 'resolve'>;
    fs: WorktreeDirectoryFs;
    homeDirectory?: string;
    resolveHomeDirectory?: () => Promise<string>;
  }
): Promise<string | undefined> {
  const trimmed = input?.trim();
  if (!trimmed) {
    return undefined;
  }

  const normalized = await normalizeWorktreeDirectory(trimmed, {
    projectPath: options.projectPath,
    pathApi: options.pathApi,
    homeDirectory: options.homeDirectory,
    resolveHomeDirectory: options.resolveHomeDirectory,
  });
  return canonicalizeWorktreeDirectory(normalized, options.fs);
}
