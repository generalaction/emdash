import { exec } from 'node:child_process';
import fs from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const DEFAULT_REMOTE = 'origin';
const DEFAULT_BRANCH = 'main';

export interface GitInfo {
  isGitRepo: boolean;
  remote?: string;
  branch?: string;
  baseRef: string;
  rootPath: string;
}

export function checkIsValidDirectory(path: string): boolean {
  return fs.existsSync(path) && fs.statSync(path).isDirectory();
}

async function resolveRealPath(target: string): Promise<string> {
  try {
    return await fs.promises.realpath(target);
  } catch {
    return target;
  }
}

function normalizeRemoteName(remote?: string | null): string {
  if (!remote) return DEFAULT_REMOTE;
  const trimmed = remote.trim();
  if (!trimmed) return '';
  if (/^[A-Za-z0-9._-]+$/.test(trimmed) && !trimmed.includes('://')) return trimmed;
  return DEFAULT_REMOTE;
}

function computeBaseRef(remote?: string | null, branch?: string | null): string {
  const remoteName = normalizeRemoteName(remote);
  if (branch?.trim()) {
    const trimmed = branch.trim();
    if (trimmed.includes('/')) return trimmed;
    return remoteName ? `${remoteName}/${trimmed}` : trimmed;
  }
  return remoteName ? `${remoteName}/${DEFAULT_BRANCH}` : DEFAULT_BRANCH;
}

async function detectDefaultBranch(
  projectPath: string,
  remote?: string | null
): Promise<string | null> {
  const remoteName = normalizeRemoteName(remote);
  if (!remoteName) {
    try {
      const { stdout } = await execAsync('git branch --show-current', { cwd: projectPath });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  try {
    const { stdout } = await execAsync(`git remote show ${remoteName}`, { cwd: projectPath });
    const match = stdout.match(/HEAD branch:\s*(\S+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

export async function detectGitInfo(projectPath: string): Promise<GitInfo> {
  const resolvedPath = await resolveRealPath(projectPath);
  const isGitRepo = fs.existsSync(join(resolvedPath, '.git'));

  if (!isGitRepo) {
    return { isGitRepo: false, baseRef: DEFAULT_BRANCH, rootPath: resolvedPath };
  }

  let remote: string | undefined;
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: resolvedPath });
    remote = stdout.trim() || undefined;
  } catch {}

  let branch: string | undefined;
  try {
    const { stdout } = await execAsync('git branch --show-current', { cwd: resolvedPath });
    branch = stdout.trim() || undefined;
  } catch {}

  if (!branch) {
    const defaultBranch = await detectDefaultBranch(resolvedPath, remote);
    branch = defaultBranch ?? undefined;
  }

  let rootPath = resolvedPath;
  try {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', { cwd: resolvedPath });
    const trimmed = stdout.trim();
    if (trimmed) rootPath = await resolveRealPath(trimmed);
  } catch {}

  return {
    isGitRepo: true,
    remote,
    branch,
    baseRef: computeBaseRef(remote, branch),
    rootPath,
  };
}

export async function isGitRepository(projectPath: string): Promise<boolean> {
  const resolvedPath = await resolveRealPath(projectPath);
  return fs.existsSync(join(resolvedPath, '.git'));
}

export function checkIsGithubRemote(remote?: string): boolean {
  return remote ? /github\.com[:/]/i.test(remote) : false;
}
