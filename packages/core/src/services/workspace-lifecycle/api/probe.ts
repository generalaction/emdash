import { access, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import type {
  ObservedWorkspaceState,
  PhaseKind,
  SetupState,
  WorkspaceListEntry,
  WorkspaceLifecyclePhase,
  WorkspaceRef,
} from '@services/workspace-lifecycle/api/api/schemas';
import {
  DIRECTORY_SETUP_STAMP_RELATIVE_PATH,
  resolveGitDir,
  SETUP_STAMP_RELATIVE_PATH,
} from '@services/workspace-lifecycle/api/steps/impl/write-setup-stamp';
import { runGit } from '@services/workspace-lifecycle/api/steps/run-git';
import {
  parseGitWorktreeList,
  type GitWorktreeEntry,
} from '@services/workspace-lifecycle/api/steps/worktree-list';

export type ProbeWorkspaceOptions = {
  signal?: AbortSignal;
};

export async function probeWorkspace(
  ref: WorkspaceRef,
  options: ProbeWorkspaceOptions = {}
): Promise<ObservedWorkspaceState> {
  return ref.kind === 'worktree'
    ? await probeWorktreeWorkspace(ref, options.signal)
    : await probeDirectoryWorkspace(ref, options.signal);
}

export function derivePhase(
  observed: ObservedWorkspaceState,
  inFlight: PhaseKind | undefined
): WorkspaceLifecyclePhase {
  if (inFlight === 'provision') return 'provisioning';
  if (inFlight === 'setup') return 'setting-up';
  if (inFlight === 'teardown') return 'tearing-down';
  if (!observed.directoryExists) return 'unprovisioned';
  return observed.setup === 'ready' ? 'ready' : 'provisioned';
}

export async function listRepoWorkspaces(
  repoPath: string,
  options: ProbeWorkspaceOptions = {}
): Promise<WorkspaceListEntry[]> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    signal: options.signal,
  });
  if (!result.success) return [];

  const entries = parseGitWorktreeList(result.data.stdout);
  return await Promise.all(
    entries.map(async (entry, index) => {
      const branchName = branchNameFromRef(entry.branch);
      const stamp = await readSetupStamp(entry.path, options.signal);
      return {
        path: entry.path,
        branchName,
        isMain: index === 0,
        directoryExists: await exists(entry.path),
        branchCreatedByEmdash: branchName
          ? await probeBranchCreatedByEmdash(repoPath, branchName, options.signal)
          : false,
        hasSetupStamp: stamp !== undefined,
        stampConfigHash: stamp?.configHash,
      };
    })
  );
}

async function probeWorktreeWorkspace(
  ref: Extract<WorkspaceRef, { kind: 'worktree' }>,
  signal: AbortSignal | undefined
): Promise<ObservedWorkspaceState> {
  const [entries, branchExists, branchCreatedByEmdash, directoryExists] = await Promise.all([
    listWorktreeEntries(ref.repoPath, signal),
    probeBranchExists(ref.repoPath, ref.branchName, signal),
    probeBranchCreatedByEmdash(ref.repoPath, ref.branchName, signal),
    exists(ref.path),
  ]);
  const refPath = await canonicalPath(ref.path);
  const registeredEntry = entries.find((entry) => samePath(entry.path, refPath));
  const registered = registeredEntry !== undefined;
  return {
    git: registered ? 'worktree' : 'none',
    path: ref.path,
    directoryExists,
    branchName: branchNameFromRef(registeredEntry?.branch) ?? ref.branchName,
    branchExists,
    branchCreatedByEmdash,
    worktree: { registered, directoryExists },
    setup: await probeSetupState(ref.path, directoryExists, ref.setupConfigHash, signal),
  };
}

async function probeDirectoryWorkspace(
  ref: Extract<WorkspaceRef, { kind: 'directory' }>,
  signal: AbortSignal | undefined
): Promise<ObservedWorkspaceState> {
  const directoryExists = await exists(ref.path);
  return {
    git: directoryExists && (await isGitRepository(ref.path, signal)) ? 'repo' : 'none',
    path: ref.path,
    directoryExists,
    branchCreatedByEmdash: false,
    setup: await probeSetupState(ref.path, directoryExists, ref.setupConfigHash, signal),
  };
}

async function probeBranchExists(
  repoPath: string,
  branchName: string,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', `refs/heads/${branchName}`], {
    cwd: repoPath,
    signal,
  });
  return result.success;
}

async function probeBranchCreatedByEmdash(
  repoPath: string,
  branchName: string,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const result = await runGit(
    ['config', '--bool', '--get', `branch.${branchName}.emdash-created`],
    {
      cwd: repoPath,
      signal,
    }
  );
  return result.success && result.data.stdout.trim() === 'true';
}

async function listWorktreeEntries(
  repoPath: string,
  signal: AbortSignal | undefined
): Promise<GitWorktreeEntry[]> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: repoPath,
    signal,
  });
  if (!result.success) return [];
  return parseGitWorktreeList(result.data.stdout);
}

async function probeSetupState(
  workspacePath: string,
  directoryExists: boolean,
  setupConfigHash: string | undefined,
  signal: AbortSignal | undefined
): Promise<SetupState> {
  if (!setupConfigHash) return 'not-applicable';
  if (!directoryExists) return 'setup-needed';

  const stamp = await readSetupStamp(workspacePath, signal);
  if (!stamp) return 'setup-needed';
  return stamp.configHash === setupConfigHash ? 'ready' : 'setup-stale';
}

async function readSetupStamp(
  workspacePath: string,
  signal: AbortSignal | undefined
): Promise<{ configHash?: string } | undefined> {
  const gitDir = await resolveGitDir(workspacePath, signal);
  const stampPaths = [
    ...(gitDir.success ? [path.join(gitDir.data, SETUP_STAMP_RELATIVE_PATH)] : []),
    path.join(workspacePath, DIRECTORY_SETUP_STAMP_RELATIVE_PATH),
  ];

  for (const stampPath of stampPaths) {
    try {
      const stamp = JSON.parse(await readFile(stampPath, 'utf8')) as { configHash?: unknown };
      return typeof stamp.configHash === 'string' ? { configHash: stamp.configHash } : {};
    } catch {
      // Try the next possible stamp location.
    }
  }
  return undefined;
}

async function isGitRepository(
  workspacePath: string,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const result = await resolveGitDir(workspacePath, signal);
  return result.success;
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function branchNameFromRef(ref: string | undefined): string | undefined {
  if (!ref?.startsWith('refs/heads/')) return undefined;
  return ref.slice('refs/heads/'.length);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

async function canonicalPath(targetPath: string): Promise<string> {
  return await realpath(targetPath).catch(() => path.resolve(targetPath));
}
