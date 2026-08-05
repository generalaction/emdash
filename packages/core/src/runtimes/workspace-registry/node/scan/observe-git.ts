import { readdir, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createBoundExec, type BoundExec } from '@services/exec/api';
import type { WorkspaceGitObservations } from '../../api/schemas';

const GIT_ENV = {
  ...process.env,
  LC_ALL: 'C',
  LANG: 'C',
  LANGUAGE: 'C',
  GIT_TERMINAL_PROMPT: '0',
  GIT_ASKPASS: '',
};

const EXEC_TIMEOUT_MS = 30_000;
/** Oversized output degrades the one workspace, never the scan (spec: T04). */
const STATUS_MAX_BUFFER = 4 * 1024 * 1024;
const UNTRACKED_FILE_MAX_BYTES = 5 * 1024 * 1024;
const UNTRACKED_FILES_MAX = 5_000;

export function createRegistryGitExec(cwd: string): BoundExec {
  return createBoundExec({ file: 'git', cwd, env: GIT_ENV });
}

export type WorktreeListing = {
  path: string;
  isMain: boolean;
  branch: string | null;
  locked: boolean;
  prunable: boolean;
  /** Git worktree admin name (the relink anchor); undefined for the main worktree. */
  adminName: string | undefined;
};

/**
 * Lists a repository's worktrees with their admin names — the registry's reconciliation
 * input. Admin names come from the common dir's `worktrees/<name>/gitdir` files.
 */
export async function listRepositoryWorktrees(repoPath: string): Promise<WorktreeListing[]> {
  const exec = createRegistryGitExec(repoPath);
  const [listResult, commonDirResult] = await Promise.all([
    exec.exec(['worktree', 'list', '--porcelain'], { timeoutMs: EXEC_TIMEOUT_MS }),
    exec.exec(['rev-parse', '--git-common-dir'], { timeoutMs: EXEC_TIMEOUT_MS }),
  ]);
  const commonDir = resolveGitPath(repoPath, commonDirResult.stdout.trim());
  const adminNames = await readAdminNames(commonDir);

  const listings: WorktreeListing[] = [];
  let current: Partial<{ path: string; branch: string; locked: boolean; prunable: boolean }> = {};
  const flush = () => {
    if (!current.path) return;
    listings.push({
      path: current.path,
      isMain: listings.length === 0,
      branch: current.branch ?? null,
      locked: current.locked ?? false,
      prunable: current.prunable ?? false,
      adminName: adminNames.get(current.path),
    });
    current = {};
  };
  for (const line of listResult.stdout.split('\n')) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line === 'locked' || line.startsWith('locked ')) current.locked = true;
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
  }
  flush();
  return listings;
}

/**
 * Computes the per-workspace git observation block. Diff stats include untracked files'
 * lines as additions (respecting .gitignore). Returns null when the workspace cannot be
 * observed — the record degrades, the scan never fails on one workspace.
 */
export async function observeWorkspaceGit(
  workspacePath: string,
  listing?: Pick<WorktreeListing, 'locked' | 'prunable'>
): Promise<WorkspaceGitObservations | null> {
  const exec = createRegistryGitExec(workspacePath);
  try {
    const [branch, status, divergence] = await Promise.all([
      readBranch(exec),
      readStatus(exec),
      readDivergence(exec),
    ]);
    const untrackedAdded = await countUntrackedLines(workspacePath, status.untracked);
    const tracked = await readTrackedDiffStats(exec);
    const diffStats =
      tracked === null && untrackedAdded === null
        ? null
        : {
            added: (tracked?.added ?? 0) + (untrackedAdded ?? 0),
            deleted: tracked?.deleted ?? 0,
          };
    return {
      branch,
      dirty: status.dirty,
      diffStats,
      ahead: divergence?.ahead ?? null,
      behind: divergence?.behind ?? null,
      locked: listing?.locked ?? false,
      prunable: listing?.prunable ?? false,
    };
  } catch {
    return null;
  }
}

async function readBranch(exec: BoundExec): Promise<string | null> {
  try {
    const result = await exec.exec(['rev-parse', '--abbrev-ref', 'HEAD'], {
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    const branch = result.stdout.trim();
    return branch === 'HEAD' || branch === '' ? null : branch;
  } catch {
    // Unborn HEAD still has a symbolic name.
    try {
      const result = await exec.exec(['symbolic-ref', '--short', 'HEAD'], {
        timeoutMs: EXEC_TIMEOUT_MS,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

async function readStatus(exec: BoundExec): Promise<{ dirty: boolean; untracked: string[] }> {
  const result = await exec.exec(['status', '--porcelain=v1', '--untracked-files=all', '-z'], {
    timeoutMs: EXEC_TIMEOUT_MS,
    maxBuffer: STATUS_MAX_BUFFER,
  });
  const entries = result.stdout.split('\0').filter((entry) => entry.length > 0);
  const untracked: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith('?? ')) untracked.push(entry.slice(3));
  }
  return { dirty: entries.length > 0, untracked };
}

async function readTrackedDiffStats(
  exec: BoundExec
): Promise<{ added: number; deleted: number } | null> {
  let stdout: string;
  try {
    ({ stdout } = await exec.exec(['diff', '--numstat', 'HEAD', '--'], {
      timeoutMs: EXEC_TIMEOUT_MS,
      maxBuffer: STATUS_MAX_BUFFER,
    }));
  } catch {
    // Unborn HEAD: no tracked baseline; untracked counting carries the additions.
    return { added: 0, deleted: 0 };
  }
  let added = 0;
  let deleted = 0;
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const [rawAdded, rawDeleted] = line.split('\t');
    added += parseNumstatValue(rawAdded);
    deleted += parseNumstatValue(rawDeleted);
  }
  return { added, deleted };
}

function parseNumstatValue(value: string | undefined): number {
  if (!value || value === '-') return 0;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

/**
 * Counts untracked files' lines the way numstat counts additions. Binary and oversized
 * files are skipped (numstat reports '-' for binary); pathological trees degrade to null
 * rather than blocking the scan.
 */
async function countUntrackedLines(
  workspacePath: string,
  untracked: string[]
): Promise<number | null> {
  if (untracked.length > UNTRACKED_FILES_MAX) return null;
  let added = 0;
  for (const relativePath of untracked) {
    try {
      const content = await readFile(join(workspacePath, relativePath));
      if (content.byteLength > UNTRACKED_FILE_MAX_BYTES) continue;
      if (content.subarray(0, 8_000).includes(0)) continue; // binary heuristic, like git's
      added += countLines(content);
    } catch {
      // Vanished mid-scan or unreadable: skip the file, keep the scan.
    }
  }
  return added;
}

function countLines(content: Buffer): number {
  if (content.byteLength === 0) return 0;
  let lines = 0;
  for (const byte of content) {
    if (byte === 10) lines += 1;
  }
  if (content[content.byteLength - 1] !== 10) lines += 1;
  return lines;
}

async function readDivergence(exec: BoundExec): Promise<{ ahead: number; behind: number } | null> {
  try {
    await exec.exec(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], {
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    const result = await exec.exec(['rev-list', '--left-right', '--count', 'HEAD...@{u}'], {
      timeoutMs: EXEC_TIMEOUT_MS,
    });
    const [aheadRaw, behindRaw] = result.stdout.trim().split(/\s+/u);
    return {
      ahead: Number.parseInt(aheadRaw ?? '0', 10) || 0,
      behind: Number.parseInt(behindRaw ?? '0', 10) || 0,
    };
  } catch {
    return null;
  }
}

async function readAdminNames(commonDir: string): Promise<Map<string, string>> {
  const byPath = new Map<string, string>();
  let entries: string[];
  try {
    entries = await readdir(join(commonDir, 'worktrees'));
  } catch {
    return byPath;
  }
  await Promise.all(
    entries.map(async (adminName) => {
      try {
        const gitdir = (
          await readFile(join(commonDir, 'worktrees', adminName, 'gitdir'), 'utf8')
        ).trim();
        byPath.set(dirname(gitdir), adminName);
      } catch {
        // Corrupted admin dirs surface as prunable in the worktree listing.
      }
    })
  );
  return byPath;
}

function resolveGitPath(cwd: string, rawPath: string): string {
  return isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
}
