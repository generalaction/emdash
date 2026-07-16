import type { ProjectWorkspaceRow } from '@shared/core/workspaces/project-workspaces';

export function shouldProposeWorkspaceCleanup(
  row: Pick<ProjectWorkspaceRow, 'kind' | 'path' | 'tasks'>,
  projectPath: string
): boolean {
  return (
    row.kind === 'candidate' ||
    (row.kind === 'workspace' && row.tasks.length === 0 && row.path !== projectPath)
  );
}
