import type path from 'node:path';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { err, ok, type Result } from '@shared/result';
import type { FileSystemProvider } from '@main/core/fs/types';

type PathApi = Pick<typeof path, 'isAbsolute' | 'join' | 'resolve'>;

export async function normalizeWorktreeDirectory(
  input: string,
  options: {
    projectPath: string;
    pathApi: PathApi;
    homeDirectory?: string;
    resolveHomeDirectory?: () => Promise<string>;
  }
): Promise<Result<string, UpdateProjectSettingsError>> {
  try {
    const trimmed = input.trim();
    let normalized = trimmed;

    if (trimmed === '~' || trimmed.startsWith('~/')) {
      const resolvedHomeDirectory = options.resolveHomeDirectory
        ? (await options.resolveHomeDirectory()).trim()
        : undefined;
      const homeDirectory = options.homeDirectory ?? resolvedHomeDirectory;
      if (!homeDirectory) {
        return err({ type: 'invalid-worktree-directory' });
      }
      normalized =
        trimmed === '~' ? homeDirectory : options.pathApi.join(homeDirectory, trimmed.slice(2));
    }

    if (options.pathApi.isAbsolute(normalized)) {
      return ok(normalized);
    }
    return ok(options.pathApi.resolve(options.projectPath, normalized));
  } catch {
    return err({ type: 'invalid-worktree-directory' });
  }
}

export async function canonicalizeWorktreeDirectory(
  directory: string,
  fs: Pick<FileSystemProvider, 'mkdir' | 'realPath'>
): Promise<Result<string, UpdateProjectSettingsError>> {
  try {
    await fs.mkdir(directory, { recursive: true });
    return ok(await fs.realPath(directory));
  } catch {
    return err({ type: 'invalid-worktree-directory' });
  }
}

export async function resolveAndValidateWorktreeDirectory(
  input: string | undefined,
  options: {
    projectPath: string;
    pathApi: Pick<typeof path, 'isAbsolute' | 'join' | 'resolve'>;
    fs: Pick<FileSystemProvider, 'mkdir' | 'realPath'>;
    homeDirectory?: string;
    resolveHomeDirectory?: () => Promise<string>;
  }
): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
  const trimmed = input?.trim();
  if (!trimmed) {
    return ok(undefined);
  }

  const normalized = await normalizeWorktreeDirectory(trimmed, {
    projectPath: options.projectPath,
    pathApi: options.pathApi,
    homeDirectory: options.homeDirectory,
    resolveHomeDirectory: options.resolveHomeDirectory,
  });
  if (!normalized.success) {
    return normalized;
  }
  return canonicalizeWorktreeDirectory(normalized.data, options.fs);
}
