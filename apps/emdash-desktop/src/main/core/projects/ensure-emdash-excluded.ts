import type { FileSystemProvider } from '@main/core/fs/types';
import { SSH_PROJECT_STATE_DIR_NAME } from '@main/core/settings/worktree-defaults';
import { log } from '@main/lib/logger';

const GIT_EXCLUDE_PATH = '.git/info/exclude';
const IGNORE_PATTERN = `${SSH_PROJECT_STATE_DIR_NAME}/`;

/**
 * Ensure the project's `.emdash/` runtime dir is git-ignored via `.git/info/exclude`.
 *
 * emdash keeps per-project state under `.emdash/` inside the repo: the SSH worktree
 * pool ({@link SSH_PROJECT_STATE_DIR_NAME}/worktrees), saved attachments, and uploaded
 * images. None of that belongs in the user's tree, so we exclude it locally rather than
 * touching a tracked `.gitignore`. `info/exclude` lives in the git common dir, so a single
 * entry on the main checkout also covers every linked task worktree.
 *
 * Best effort and idempotent: skips repos without a real `.git` directory (linked
 * worktrees / submodules use a `.git` file whose exclude is out of this fs's root) and
 * skips when `.emdash` is already ignored (e.g. via a global gitignore).
 */
export async function ensureEmdashGitExcluded(fs: FileSystemProvider): Promise<void> {
  const gitDir = await fs.stat('.git').catch(() => null);
  if (gitDir?.type !== 'dir') return;

  const existing = (await fs.exists(GIT_EXCLUDE_PATH))
    ? (await fs.read(GIT_EXCLUDE_PATH)).content
    : '';

  const alreadyExcluded = existing
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === SSH_PROJECT_STATE_DIR_NAME || line === IGNORE_PATTERN);
  if (alreadyExcluded) return;

  const base = existing.replace(/\s*$/, '');
  const next = base.length > 0 ? `${base}\n${IGNORE_PATTERN}\n` : `${IGNORE_PATTERN}\n`;
  const result = await fs.write(GIT_EXCLUDE_PATH, next);
  if (!result.success) {
    throw new Error(result.error ?? `failed to write ${GIT_EXCLUDE_PATH}`);
  }
}

/** Fire-and-forget wrapper that never rejects; logs and moves on. */
export function ensureEmdashGitExcludedSafe(fs: FileSystemProvider, projectId: string): void {
  void ensureEmdashGitExcluded(fs).catch((error) => {
    log.warn('ensureEmdashGitExcluded failed', {
      projectId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
