import { execFile } from 'child_process';
import { promisify } from 'util';
import { log } from '../lib/logger';

const execFileAsync = promisify(execFile);

/**
 * Result of a remote branch deletion attempt.
 */
export interface RemoteBranchDeletionResult {
  /** Whether the deletion was executed (true even if the branch was already absent). */
  success: boolean;
  /** True if the branch did not exist on the remote (already deleted or never pushed). */
  alreadyAbsent: boolean;
  /** True if the remote ('origin' by default) is not configured for the repo. */
  noRemote: boolean;
  /** Human-readable detail message suitable for logs / UI toasts. */
  message: string;
}

/** Patterns that indicate the remote branch was already gone. */
const ALREADY_ABSENT_PATTERNS = [
  /remote ref does not exist/i,
  /unknown revision/i,
  /not found/i,
  /error: unable to delete '[^']*': remote ref does not exist/i,
];

/**
 * Check whether a given remote alias exists for the repository.
 */
async function hasRemote(projectPath: string, remote: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['remote'], { cwd: projectPath });
    return stdout
      .split('\n')
      .map((l) => l.trim())
      .includes(remote);
  } catch {
    return false;
  }
}

/**
 * Determine the date (ISO string) of the most recent commit on a branch.
 * Returns `null` if the branch doesn't exist locally.
 */
async function getLastCommitDate(projectPath: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['log', '-1', '--format=%aI', branch, '--'], {
      cwd: projectPath,
    });
    const trimmed = stdout.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * Dedicated service for managing remote branch lifecycle operations.
 *
 * This service encapsulates the logic for deleting remote branches
 * with robust error handling and graceful degradation for common
 * failure scenarios (branch already deleted, no remote configured,
 * network timeouts, etc.).
 */
export class RemoteBranchService {
  /**
   * Delete a remote branch.
   *
   * @param projectPath — Absolute path to the local git repository (or worktree root).
   * @param branch      — Branch name to delete on the remote. May optionally include
   *                       the `origin/` prefix, which is stripped automatically.
   * @param remote      — Remote alias (defaults to `'origin'`).
   *
   * @returns `RemoteBranchDeletionResult` describing the outcome. The method
   *          **never throws** — all errors are caught and returned as a failed result.
   */
  async deleteRemoteBranch(
    projectPath: string,
    branch: string,
    remote = 'origin'
  ): Promise<RemoteBranchDeletionResult> {
    // -------------------------------------------------------------------
    // Guard: no remote configured
    // -------------------------------------------------------------------
    try {
      const remoteExists = await hasRemote(projectPath, remote);
      if (!remoteExists) {
        const msg = `Skipping remote branch deletion — no remote "${remote}" configured.`;
        log.info(msg);
        return { success: true, alreadyAbsent: false, noRemote: true, message: msg };
      }
    } catch (err) {
      const msg = `Could not verify remote "${remote}" existence: ${String(err)}`;
      log.warn(msg);
      return { success: false, alreadyAbsent: false, noRemote: false, message: msg };
    }

    // Normalise: remove leading "origin/" if present
    let remoteBranch = branch;
    const prefixPattern = new RegExp(`^${remote}/`);
    if (prefixPattern.test(remoteBranch)) {
      remoteBranch = remoteBranch.replace(prefixPattern, '');
    }

    if (!remoteBranch) {
      const msg = 'Cannot delete remote branch — empty branch name.';
      log.warn(msg);
      return { success: false, alreadyAbsent: false, noRemote: false, message: msg };
    }

    // -------------------------------------------------------------------
    // Execute: git push <remote> --delete <branch>
    // -------------------------------------------------------------------
    try {
      await execFileAsync('git', ['push', remote, '--delete', remoteBranch], {
        cwd: projectPath,
        timeout: 30_000, // 30 s network timeout
      });
      const msg = `Deleted remote branch ${remote}/${remoteBranch}.`;
      log.info(msg);
      return { success: true, alreadyAbsent: false, noRemote: false, message: msg };
    } catch (error: unknown) {
      const stderr = extractStderr(error);

      // Known benign errors: branch was already absent
      if (ALREADY_ABSENT_PATTERNS.some((pattern) => pattern.test(stderr))) {
        const msg = `Remote branch ${remote}/${remoteBranch} already absent.`;
        log.info(msg);
        return { success: true, alreadyAbsent: true, noRemote: false, message: msg };
      }

      // Unknown / network error — log, but don't throw
      const msg = `Failed to delete remote branch ${remote}/${remoteBranch}: ${stderr}`;
      log.warn(msg);
      return { success: false, alreadyAbsent: false, noRemote: false, message: msg };
    }
  }

  /**
   * Determine whether a branch qualifies as "stale" based on the configured
   * days threshold and the date of its most recent commit.
   *
   * @returns `true` if the branch's last commit is older than `daysThreshold`
   *          days, or if the last commit date cannot be determined (conservative).
   */
  async isBranchStale(
    projectPath: string,
    branch: string,
    daysThreshold: number
  ): Promise<boolean> {
    const dateStr = await getLastCommitDate(projectPath, branch);
    if (!dateStr) {
      // Cannot determine — treat as stale so users aren't surprised by
      // branches that silently escape cleanup.
      return true;
    }

    const commitDate = new Date(dateStr);
    if (isNaN(commitDate.getTime())) {
      return true;
    }

    const now = new Date();
    const diffMs = now.getTime() - commitDate.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= daysThreshold;
  }

  /**
   * Evaluate the cleanup setting to decide whether a remote branch should be
   * deleted right now. This does **not** perform the deletion — call
   * `deleteRemoteBranch()` separately if the answer is `'delete'`.
   *
   * @returns `'delete'` | `'skip'` | `'ask'`
   */
  async evaluateCleanupAction(
    projectPath: string,
    branch: string,
    mode: import('@shared/remoteBranchCleanup').RemoteBranchCleanupMode,
    daysThreshold: number
  ): Promise<'delete' | 'skip' | 'ask'> {
    switch (mode) {
      case 'always':
        return 'delete';
      case 'never':
        return 'skip';
      case 'ask':
        return 'ask';
      case 'auto': {
        const stale = await this.isBranchStale(projectPath, branch, daysThreshold);
        return stale ? 'delete' : 'skip';
      }
      default:
        return 'skip';
    }
  }
}

/** Extract the stderr string from a child-process error. */
function extractStderr(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>;
    if (typeof e.stderr === 'string' && e.stderr) return e.stderr;
    if (typeof e.message === 'string' && e.message) return e.message;
  }
  return String(error);
}

/** Module-level singleton, following the project convention. */
export const remoteBranchService = new RemoteBranchService();
