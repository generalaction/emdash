import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { BoundExec } from '#services/exec/api';
import { createRegistryGitExec } from './scan/observe-git';
import { validateWorktreePath } from './worktree-path-safety';

export type CreateWorktreeExecution = {
  repositoryPath: string;
  /** Resolved target path; may not exist yet. */
  worktreePath: string;
  branch: string;
  baseRef: string;
  /** Overlay feeder: called as each stage begins. */
  onStage: (stage: string) => void;
};

export type CreateWorktreeExecutionResult =
  | { status: 'succeeded'; finalPath: string; createdWorktree: boolean }
  | { status: 'failed'; stage: string; message: string };

/**
 * The foreground createWorktree stage pipeline (ADR 0005): inspect → resolve-base →
 * add-worktree → verify. This is everything an agent needs to start working — tracked
 * files checked out and functional git. Artifact cloning, branch pushing, and ref
 * freshening are background steps owned by the runtime, never awaited here. Failures
 * return stage-tagged results for the durable outcome; rollback of artifacts created in
 * this attempt is best-effort — irremovable debris is left for auto-adoption to surface.
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
    // Stale-is-fine: creation never fetches when the base ref resolves locally. Only an
    // unresolvable remote-shaped ref triggers a targeted single-ref fetch — no --all,
    // no --prune, no tags. Failure surfaces git's own error; no emdash timeout or retry.
    execution.onStage('resolve-base');
    try {
      if (
        !(await branchExists(exec, execution.branch)) &&
        !(await refResolves(exec, execution.baseRef))
      ) {
        const remoteRef = await parseRemoteRef(exec, execution.baseRef);
        if (remoteRef) {
          execution.onStage('fetch-base');
          await exec.exec([
            'fetch',
            remoteRef.remote,
            `+refs/heads/${remoteRef.branch}:refs/remotes/${remoteRef.remote}/${remoteRef.branch}`,
            '--no-tags',
          ]);
        }
        // Non-remote-shaped unresolvable refs fall through: add-worktree fails with
        // git's own "invalid reference" error, exactly as it would have after a fetch.
      }
    } catch (error) {
      return await fail('resolve-base', error);
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

  return { status: 'succeeded', finalPath, createdWorktree };
}

/**
 * Interprets a base ref of the shape `<remote>/<branch>` against the repository's
 * actual remotes. Returns null for refs that are not remote-shaped (plain local
 * branches, SHAs, tags) — those cannot be freshened by a targeted fetch.
 */
async function parseRemoteRef(
  exec: BoundExec,
  baseRef: string
): Promise<{ remote: string; branch: string } | null> {
  const separator = baseRef.indexOf('/');
  if (separator <= 0 || separator === baseRef.length - 1) return null;
  const remote = baseRef.slice(0, separator);
  const branch = baseRef.slice(separator + 1);
  const remotes = (await exec.exec(['remote'])).stdout.trim().split('\n').filter(Boolean);
  return remotes.includes(remote) ? { remote, branch } : null;
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

async function canonicalOrResolved(target: string): Promise<string> {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
}
