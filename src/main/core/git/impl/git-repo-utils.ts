/**
 * Standalone git utility functions for repository-level operations that don't
 * belong on the path-scoped GitService (e.g. cloning, initial project setup,
 * fetching PR refs).
 *
 * All functions accept an IExecutionContext so they remain testable
 * without touching the real filesystem or spawning real processes.
 */

import type { IExecutionContext } from '@main/core/execution-context/types';
import type { FileSystemProvider } from '@main/core/fs/types';

// ---------------------------------------------------------------------------
// cloneRepository
// ---------------------------------------------------------------------------

/**
 * Clone a git repository to a local path.
 * The caller is responsible for ensuring the parent directory exists.
 * The context's root is used as the working directory for the clone command.
 */
export async function cloneRepository(
  repoUrl: string,
  localPath: string,
  ctx: IExecutionContext
): Promise<{ success: boolean; error?: string }> {
  // Reject values that could be reparsed by git as options (`--upload-pack=…`
  // and friends in the CVE-2017-1000117 / CVE-2018-17456 / CVE-2024-32002
  // family). Modern git also blocks most of these, but `--` is the canonical
  // hardening and costs nothing.
  if (repoUrl.startsWith('-') || localPath.startsWith('-')) {
    return { success: false, error: 'Invalid clone arguments' };
  }
  try {
    await ctx.exec('git', ['clone', '--', repoUrl, localPath]);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Clone failed',
    };
  }
}

// ---------------------------------------------------------------------------
// initializeNewProject
// ---------------------------------------------------------------------------

export interface InitializeNewProjectParams {
  repoUrl: string;
  localPath: string;
  name: string;
  description?: string;
}

/**
 * Initialize a freshly-cloned (empty) project with a README and initial commit.
 * The context must be rooted at `localPath` so git commands run there directly.
 *
 * Steps:
 *  1. Write a README.md
 *  2. `git add README.md`
 *  3. `git commit -m "Initial commit"`
 *  4. `git push -u origin main` (falls back to `master` if `main` fails)
 */
export async function initializeNewProject(
  params: InitializeNewProjectParams,
  ctx: IExecutionContext,
  fs: FileSystemProvider
): Promise<void> {
  const { name, description } = params;

  const exists = await fs.exists('.');
  if (!exists) {
    throw new Error('Local path does not exist');
  }

  const readmeContent = description ? `# ${name}\n\n${description}\n` : `# ${name}\n`;
  await fs.write('README.md', readmeContent);

  await ctx.exec('git', ['add', 'README.md']);
  await ctx.exec('git', ['commit', '-m', 'Initial commit']);

  try {
    await ctx.exec('git', ['push', '-u', 'origin', 'main']);
  } catch {
    try {
      await ctx.exec('git', ['push', '-u', 'origin', 'master']);
    } catch {
      throw new Error('Failed to push to remote repository');
    }
  }
}
