import fs from 'node:fs/promises';
import path from 'node:path';
import type { BoundExec } from '@emdash/core/exec';
import {
  gitErrorMessage,
  MAX_STATUS_FILES,
  StatusParser,
  type CheckoutOperation,
  type CheckoutStatusModel,
  type FileGitStatus,
  type FileStatus,
  type GitChangeStatus,
  type GitStatusCode,
} from '@emdash/core/git';

/**
 * Computes the checkout status model from `git status --porcelain=v2`.
 * Total: expected failures are encoded as the model's `error` variant so
 * subscribers always see the latest truth.
 *
 * Git reports checkout-relative paths; the model exposes absolute paths
 * (joined onto `checkoutPath`) per the repo-wide path convention.
 */
export async function computeStatusModel(
  exec: BoundExec,
  gitDir: string,
  checkoutPath: string
): Promise<CheckoutStatusModel> {
  try {
    const parser = new StatusParser();
    await exec.execStreaming(
      ['--no-optional-locks', 'status', '--porcelain=v2', '-z', '-uall'],
      (chunk) => {
        parser.update(chunk);
        return !parser.tooManyFiles;
      }
    );
    if (parser.tooManyFiles || parser.status.length > MAX_STATUS_FILES) {
      return { kind: 'too-many-files' };
    }
    const operation = await detectOperation(gitDir);
    return buildStatusModel(parser.status, operation, checkoutPath);
  } catch (error) {
    return { kind: 'error', message: gitErrorMessage(error) };
  }
}

export function buildStatusModel(
  entries: FileStatus[],
  operation: CheckoutOperation,
  checkoutPath: string
): CheckoutStatusModel {
  const record: Record<string, FileGitStatus> = {};
  const summary = { staged: 0, unstaged: 0, conflicted: 0, untracked: 0 };

  for (const entry of entries) {
    // For renames the parser puts the new path in `rename` and the original in `path`.
    const currentPath = path.join(checkoutPath, entry.rename ?? entry.path);
    const isConflicted = isConflictCode(entry.x, entry.y);
    const fileStatus: FileGitStatus = {
      path: currentPath,
      index: codeToStatus(entry.x),
      worktree: codeToStatus(entry.y),
      isConflicted,
    };
    if (entry.rename) fileStatus.origPath = path.join(checkoutPath, entry.path);
    record[currentPath] = fileStatus;

    if (isConflicted) {
      summary.conflicted += 1;
      continue;
    }
    if (entry.x === '?') {
      summary.untracked += 1;
      continue;
    }
    if (entry.x !== ' ' && entry.x !== '!') summary.staged += 1;
    if (entry.y !== ' ' && entry.y !== '?' && entry.y !== '!') summary.unstaged += 1;
  }

  return { kind: 'ok', entries: record, summary, operation };
}

/** In-progress operation detection via the worktree git dir's state files. */
export async function detectOperation(gitDir: string): Promise<CheckoutOperation> {
  if (
    (await exists(path.join(gitDir, 'rebase-merge'))) ||
    (await exists(path.join(gitDir, 'rebase-apply')))
  ) {
    return 'rebase';
  }
  if (await exists(path.join(gitDir, 'MERGE_HEAD'))) return 'merge';
  if (await exists(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick';
  if (await exists(path.join(gitDir, 'REVERT_HEAD'))) return 'revert';
  if (await exists(path.join(gitDir, 'BISECT_LOG'))) return 'bisect';
  return 'none';
}

export function mapGitChangeStatus(code: string): GitChangeStatus {
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflicted';
  if (code.includes('A') || code.includes('?')) return 'added';
  if (code.includes('D')) return 'deleted';
  if (code.includes('R')) return 'renamed';
  return 'modified';
}

function codeToStatus(code: string): GitStatusCode {
  switch (code) {
    case 'M':
    case 'm':
      return 'modified';
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    case 'T':
      return 'type-changed';
    case 'U':
      return 'unmerged';
    case '?':
      return 'untracked';
    case '!':
      return 'ignored';
    default:
      return 'unmodified';
  }
}

function isConflictCode(x: string, y: string): boolean {
  return x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D');
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
