import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import type {
  ObservedWorkspaceState,
  PhaseKind,
  SetupState,
  WorkspaceLifecyclePhase,
  WorkspaceRef,
} from './api/schemas';
import { resolveGitDir, SETUP_STAMP_RELATIVE_PATH } from './steps/impl/write-setup-stamp';
import { runGit } from './steps/run-git';
import { parseGitWorktreeList, worktreePathForBranch } from './steps/worktree-list';

export type ProbeWorkspaceOptions = {
  signal?: AbortSignal;
};

export async function probeWorkspace(
  ref: WorkspaceRef,
  options: ProbeWorkspaceOptions = {}
): Promise<ObservedWorkspaceState> {
  const [branchExists, branchCreatedByEmdash, worktreePath] = await Promise.all([
    probeBranchExists(ref, options.signal),
    probeBranchCreatedByEmdash(ref, options.signal),
    probeWorktreePath(ref, options.signal),
  ]);
  const worktree = worktreePath
    ? {
        path: worktreePath,
        directoryExists: await exists(worktreePath),
      }
    : undefined;

  return {
    branchExists,
    branchCreatedByEmdash,
    worktree,
    setup: await probeSetupState(worktree, ref.setupConfigHash, options.signal),
  };
}

export function derivePhase(
  observed: ObservedWorkspaceState,
  inFlight: PhaseKind | undefined
): WorkspaceLifecyclePhase {
  if (inFlight === 'provision') return 'provisioning';
  if (inFlight === 'setup') return 'setting-up';
  if (inFlight === 'teardown') return 'tearing-down';
  if (!observed.worktree?.directoryExists) return 'unprovisioned';
  return observed.setup === 'ready' ? 'ready' : 'provisioned';
}

async function probeBranchExists(
  ref: WorkspaceRef,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const result = await runGit(['rev-parse', '--verify', `refs/heads/${ref.branchName}`], {
    cwd: ref.repoPath,
    signal,
  });
  return result.success;
}

async function probeBranchCreatedByEmdash(
  ref: WorkspaceRef,
  signal: AbortSignal | undefined
): Promise<boolean> {
  const result = await runGit(
    ['config', '--bool', '--get', `branch.${ref.branchName}.emdash-created`],
    {
      cwd: ref.repoPath,
      signal,
    }
  );
  return result.success && result.data.stdout.trim() === 'true';
}

async function probeWorktreePath(
  ref: WorkspaceRef,
  signal: AbortSignal | undefined
): Promise<string | undefined> {
  const result = await runGit(['worktree', 'list', '--porcelain'], {
    cwd: ref.repoPath,
    signal,
  });
  if (!result.success) return undefined;
  return worktreePathForBranch(parseGitWorktreeList(result.data.stdout), ref.branchName);
}

async function probeSetupState(
  worktree: ObservedWorkspaceState['worktree'],
  setupConfigHash: string | undefined,
  signal: AbortSignal | undefined
): Promise<SetupState> {
  if (!setupConfigHash) return 'not-applicable';
  if (!worktree?.directoryExists) return 'setup-needed';

  const gitDir = await resolveGitDir(worktree.path, signal);
  if (!gitDir.success) return 'setup-needed';

  try {
    const stamp = JSON.parse(
      await readFile(path.join(gitDir.data, SETUP_STAMP_RELATIVE_PATH), 'utf8')
    ) as { configHash?: unknown };
    if (stamp.configHash !== setupConfigHash) return 'setup-stale';
    return 'ready';
  } catch {
    return 'setup-needed';
  }
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}
