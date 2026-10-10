import { toBranchRef, type GitBranchRef } from '@emdash/core/runtimes/git/api';
import { err, ok, type Result } from '@emdash/shared';
import type { ProjectProvider } from '@core/features/projects/api/node/project-provider';
import { resolveProjectEffectiveSettings } from '@core/features/projects/api/node/settings/effective-settings';

/**
 * Practical subset of `git check-ref-format --branch`: rejects names git would
 * refuse, so task creation fails with a clear message instead of deep in
 * worktree provisioning after the task row already exists.
 */
export function isValidBranchName(name: string): boolean {
  if (!name || name === '@') return false;
  if (/[\s~^:?*[\\\x00-\x1f\x7f]/.test(name)) return false;
  if (name.startsWith('-') || name.startsWith('/') || name.endsWith('/')) return false;
  if (name.includes('..') || name.includes('@{') || name.includes('//')) return false;
  return !name
    .split('/')
    .some(
      (segment) => segment.startsWith('.') || segment.endsWith('.') || segment.endsWith('.lock')
    );
}

/**
 * Resolves the base ref for a new task branch, matching what the new-task modal
 * picks for the "new worktree" preset: the project's effective default branch
 * when no base is requested, otherwise the named branch preferring the base
 * remote's copy over a local one.
 */
export async function resolveFromBranch(
  project: ProjectProvider,
  requested: string | undefined
): Promise<Result<GitBranchRef, string>> {
  const [effective, refs] = await Promise.all([
    resolveProjectEffectiveSettings({
      settings: project.settings,
      repoFacts: project.repoFacts,
      projectId: project.projectId,
    }),
    project.git.repository.model.state(project.repository, 'refs').snapshot(),
  ]);
  const branches = refs.data.branches.map(toBranchRef);
  const baseRemote = effective.baseRemote.value;

  const branch = requested?.trim();
  if (!branch) {
    const fallback = effective.defaultBranch.value;
    if (!fallback) {
      return err(
        'The project has no resolvable default branch; pass baseBranch with an existing branch name.'
      );
    }
    const picked = pick(branches, fallback.branch, fallback.remote ?? baseRemote);
    // The resolver can name a branch the refs snapshot has not caught up with;
    // a local ref is still a valid base for the worktree in that case.
    return ok(picked ?? { type: 'local', branch: fallback.branch });
  }

  const picked = pick(branches, branch, baseRemote);
  if (!picked) {
    const hint = branch.includes('/')
      ? ' Pass the branch name without a remote prefix (e.g. "main" instead of "origin/main").'
      : '';
    return err(`Branch "${branch}" not found in the repository.${hint}`);
  }
  return ok(picked);
}

function pick(
  branches: GitBranchRef[],
  branch: string,
  preferredRemote: string | null
): GitBranchRef | undefined {
  const candidates = branches.filter((candidate) => candidate.branch === branch);
  return (
    candidates.find(
      (candidate) => candidate.type === 'remote' && candidate.remote.name === preferredRemote
    ) ??
    candidates.find((candidate) => candidate.type === 'local') ??
    candidates[0]
  );
}
