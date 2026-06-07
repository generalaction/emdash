import type path from 'node:path';
import type { FileSystemProvider } from '@main/core/fs/types';
import { err, ok, type Result } from '@shared/lib/result';
import type { UpdateProjectSettingsError } from '@shared/projects';

export type PathPlatform = 'posix' | 'win32';

type PathApi = Pick<typeof path, 'join'>;

function isWindowsDriveAbsolute(input: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(input);
}

function isWindowsUncAbsolute(input: string): boolean {
  return input.startsWith('\\\\');
}

function isPosixAbsolute(input: string): boolean {
  return input.startsWith('/');
}

function isNativeAbsolute(input: string, platform: PathPlatform): boolean {
  if (platform === 'win32') return isWindowsDriveAbsolute(input) || isWindowsUncAbsolute(input);
  return isPosixAbsolute(input);
}

export async function normalizeWorktreeDirectory(
  input: string,
  options: {
    pathApi: PathApi;
    pathPlatform: PathPlatform;
    homeDirectory?: string;
    resolveHomeDirectory?: () => Promise<string>;
  }
): Promise<Result<string, UpdateProjectSettingsError>> {
  try {
    const trimmed = input.trim();
    let normalized = trimmed;

    if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
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

    if (isNativeAbsolute(normalized, options.pathPlatform)) {
      return ok(normalized);
    }
    return err({ type: 'invalid-worktree-directory' });
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
    pathApi: PathApi;
    pathPlatform: PathPlatform;
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
    pathApi: options.pathApi,
    pathPlatform: options.pathPlatform,
    homeDirectory: options.homeDirectory,
    resolveHomeDirectory: options.resolveHomeDirectory,
  });
  if (!normalized.success) {
    return normalized;
  }
  return canonicalizeWorktreeDirectory(normalized.data, options.fs);
}
