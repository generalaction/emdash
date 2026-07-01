import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { err, type Result } from '@emdash/shared';
import type { UpdateProjectSettingsError } from '@shared/projects';
import {
  normalizeWorktreeDirectory,
  resolveAndValidateWorktreeDirectory,
  type PathPlatform,
} from './worktree-directory';

const localPathPlatform: PathPlatform = process.platform === 'win32' ? 'win32' : 'posix';

const localWorktreeDirectoryFs = {
  mkdir: async (p: string, options?: { recursive?: boolean }) => {
    await fs.promises.mkdir(p, options);
  },
  realPath: async (p: string) => fs.promises.realpath(p),
};

export function resolveAndValidateLocalWorktreeDirectory(
  worktreeDirectory: string | undefined
): Promise<Result<string | undefined, UpdateProjectSettingsError>> {
  return resolveAndValidateWorktreeDirectory(worktreeDirectory, {
    pathApi: path,
    pathPlatform: localPathPlatform,
    fs: localWorktreeDirectoryFs,
    homeDirectory: os.homedir(),
  });
}

export function normalizeStoredLocalWorktreeDirectory(
  worktreeDirectory: string
): Promise<Result<string, UpdateProjectSettingsError>> {
  return normalizeWorktreeDirectory(worktreeDirectory, {
    pathApi: path,
    pathPlatform: localPathPlatform,
    homeDirectory: os.homedir(),
  });
}

export async function normalizeExistingLocalWorktreeDirectory(
  worktreeDirectory: string | undefined
): Promise<Result<string, UpdateProjectSettingsError>> {
  const trimmed = worktreeDirectory?.trim();
  if (!trimmed) return err({ type: 'invalid-worktree-directory' });

  const normalized = await normalizeStoredLocalWorktreeDirectory(trimmed);
  if (!normalized.success) return normalized;

  try {
    return { success: true, data: await fs.promises.realpath(normalized.data) };
  } catch {
    return normalized;
  }
}
