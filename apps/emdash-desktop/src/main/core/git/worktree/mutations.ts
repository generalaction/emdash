import { err, ok } from '@emdash/shared';
import { resolveWorkspace } from '@main/core/projects/utils';
import { log } from '@main/lib/logger';
import { telemetryService } from '@main/lib/telemetry';
import type { GitWorktreeMutationResult } from '@shared/core/git/rpc';

type WorktreeMutationScope = 'single' | 'multiple';

export async function stageWorktreeFiles(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: WorktreeMutationScope
): Promise<GitWorktreeMutationResult> {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const sequences = await workspace.gitWorktree.stage(paths);
    telemetryService.capture('vcs_files_staged', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.stage failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error', message: String(error) });
  }
}

export async function unstageWorktreeFiles(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: WorktreeMutationScope
): Promise<GitWorktreeMutationResult> {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const sequences = await workspace.gitWorktree.unstage(paths);
    telemetryService.capture('vcs_files_unstaged', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.unstage failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error', message: String(error) });
  }
}

export async function revertWorktreeFiles(
  projectId: string,
  workspaceId: string,
  paths: string[],
  scope: WorktreeMutationScope
): Promise<GitWorktreeMutationResult> {
  try {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const sequences = await workspace.gitWorktree.revert(paths);
    telemetryService.capture('vcs_files_discarded', {
      count: paths.length,
      scope,
      project_id: projectId,
      task_id: workspaceId,
    });
    return ok({ sequences });
  } catch (error) {
    log.error('gitCtrl.revert failed', { projectId, workspaceId, paths, error });
    return err({ type: 'git_error', message: String(error) });
  }
}
