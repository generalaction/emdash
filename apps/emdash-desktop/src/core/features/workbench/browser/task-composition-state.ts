import type { TaskDiffSelectionState } from '@core/features/tasks/contributions/mementos';
import {
  relativeToWorkspace,
  resolveWorkspacePath,
} from '@core/features/workspaces/api/browser/workspace-path';

export function sanitizeDiffSelection(
  value: TaskDiffSelectionState,
  dependencies: { workspacePath: string; validPaths: ReadonlySet<string> }
): TaskDiffSelectionState {
  const activeFile = value.activeFile;
  if (!activeFile || activeFile.group === 'pr') return value;
  const relativePath = relativeToWorkspace(dependencies.workspacePath, activeFile.path);
  const path = resolveWorkspacePath(dependencies.workspacePath, activeFile.path);
  if (
    (activeFile.group === 'disk' || activeFile.group === 'staged') &&
    !dependencies.validPaths.has(relativePath)
  ) {
    return { ...value, activeFile: undefined };
  }
  return { ...value, activeFile: { ...activeFile, path } };
}
