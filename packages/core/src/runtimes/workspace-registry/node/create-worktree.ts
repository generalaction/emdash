import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BoundExec } from '#services/exec/api';
import { copyPreservedFiles } from './copy-preserved-files';
import { createRegistryGitExec } from './scan/observe-git';
import { validateWorktreePath } from './worktree-path-safety';

export type CreateWorktreeExecution = {
  repositoryPath: string;
  /** Resolved target path; may not exist yet. */
  worktreePath: string;
  branch: string;
  baseRef: string;
  preservePatterns: string[];
  pushBranch: boolean;
  /** Overlay feeder: called as each stage begins. */
  onStage: (stage: string) => void;
};

export type CreateWorktreeExecutionResult =
  | { status: 'succeeded'; finalPath: string }
  | { status: 'failed'; stage: string; message: string };

/**
 * The createWorktree stage pipeline (ADR 0005): inspect → fetch → add-worktree →
 * verify → copy-preserved-files → push-branch. Adapted from the legacy workspace-host
 * handler, minus the operation kernel: failures return stage-tagged results for the
 * durable outcome; rollback of artifacts created in this attempt is best-effort —
 * irremovable debris is left for auto-adoption to surface.
 */
export async function executeCreateWorktree(
  execution: CreateWorktreeExecution
): Promise<CreateWorktreeExecutionResult> {
  const exec = createRegistryGitExec(execution.repositoryPath);
  let existing = false;
  let createdWorktree = false;
  let createdBranch = false;

  const fail = async (stage: string, error: unknown): Promise<CreateWorktreeExecutionResult> => {
    await rollback(exec, execution, { createdWorktree, createdBranch });
    return {
      status: 'failed',
      stage,
      message: error instanceof Error ? error.message : String(error),
    };
  };

  execution.onStage('inspect');
  try {
    const safe = await validateWorktreePath({
      repoPath: execution.repositoryPath,
      targetPath: execution.worktreePath,
      mutation: 'create',
    });
    if (!safe.success) {
      return { status: 'failed', stage: 'inspect', message: safe.error.message };
    }
    existing = (await listWorktreePaths(exec)).has(
      await canonicalOrResolved(execution.worktreePath)
    );
    if (existing) {
      const current = (
        await createRegistryGitExec(execution.worktreePath).exec(['branch', '--show-current'])
      ).stdout.trim();
      if (current !== execution.branch) {
        return {
          status: 'failed',
          stage: 'inspect',
          message:
            `Worktree ${execution.worktreePath} is checked out on ` +
            `${current || 'a detached HEAD'}, not ${execution.branch}`,
        };
      }
    }
  } catch (error) {
    return await fail('inspect', error);
  }

  if (!existing) {
    execution.onStage('fetch');
    try {
      if (await hasRemotes(exec)) {
        try {
          await exec.exec(['fetch', '--all', '--prune']);
        } catch (fetchError) {
          // Offline is tolerable when the base ref resolves locally.
          if (!(await refResolves(exec, execution.baseRef))) throw fetchError;
        }
      }
    } catch (error) {
      return await fail('fetch', error);
    }

    execution.onStage('add-worktree');
    try {
      if (await branchExists(exec, execution.branch)) {
        await exec.exec(['worktree', 'add', execution.worktreePath, execution.branch]);
      } else {
        await exec.exec([
          'worktree',
          'add',
          '-b',
          execution.branch,
          execution.worktreePath,
          execution.baseRef,
        ]);
        createdBranch = true;
      }
      createdWorktree = true;
    } catch (error) {
      return await fail('add-worktree', error);
    }
  }

  execution.onStage('verify');
  let finalPath: string;
  try {
    finalPath = await canonicalOrResolved(execution.worktreePath);
    if (!(await listWorktreePaths(exec)).has(finalPath)) {
      return await fail(
        'verify',
        new Error(`Worktree was not listed after creation: ${execution.worktreePath}`)
      );
    }
  } catch (error) {
    return await fail('verify', error);
  }

  if (!existing && execution.preservePatterns.length > 0) {
    execution.onStage('copy-preserved-files');
    try {
      const warnings = await copyPreservedFiles({
        repoPath: execution.repositoryPath,
        worktreePath: finalPath,
        patterns: execution.preservePatterns,
        git: exec,
      });
      if (warnings.length > 0) {
        return await fail('copy-preserved-files', new Error(warnings.join('\n')));
      }
    } catch (error) {
      return await fail('copy-preserved-files', error);
    }
  }

  if (execution.pushBranch) {
    execution.onStage('push-branch');
    try {
      const remote = await defaultRemote(exec);
      if (!remote) {
        return await fail('push-branch', new Error('Repository has no remote to push to'));
      }
      await exec.exec(['push', '-u', remote, execution.branch]);
    } catch (error) {
      return await fail('push-branch', error);
    }
  }

  return { status: 'succeeded', finalPath };
}

async function rollback(
  exec: BoundExec,
  execution: CreateWorktreeExecution,
  created: { createdWorktree: boolean; createdBranch: boolean }
): Promise<void> {
  try {
    if (created.createdWorktree) {
      await exec.exec(['worktree', 'remove', '--force', execution.worktreePath]);
    }
    if (created.createdBranch) {
      await exec.exec(['branch', '-D', execution.branch]);
    }
  } catch {
    // Best-effort only: leftover debris is surfaced by adoption, never hidden.
  }
}

async function listWorktreePaths(exec: BoundExec): Promise<Set<string>> {
  const result = await exec.exec(['worktree', 'list', '--porcelain']);
  const paths = new Set<string>();
  for (const line of result.stdout.split('\n')) {
    if (!line.startsWith('worktree ')) continue;
    paths.add(await canonicalOrResolved(line.slice('worktree '.length)));
  }
  return paths;
}

async function branchExists(exec: BoundExec, branch: string): Promise<boolean> {
  try {
    await exec.exec(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]);
    return true;
  } catch {
    return false;
  }
}

async function refResolves(exec: BoundExec, ref: string): Promise<boolean> {
  try {
    await exec.exec(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function hasRemotes(exec: BoundExec): Promise<boolean> {
  const result = await exec.exec(['remote']);
  return result.stdout.trim().length > 0;
}

async function defaultRemote(exec: BoundExec): Promise<string | null> {
  const remotes = (await exec.exec(['remote'])).stdout.trim().split('\n').filter(Boolean);
  if (remotes.includes('origin')) return 'origin';
  return remotes[0] ?? null;
}

async function canonicalOrResolved(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}
