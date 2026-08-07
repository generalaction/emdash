import {
  splitPanePanelId,
  type TaskDiffSelectionState,
} from '@core/features/tasks/contributions/mementos';
import {
  relativeToWorkspace,
  resolveWorkspacePath,
} from '@core/features/workspaces/api/browser/workspace-path';
import type { MementoLayoutStorage } from '@core/primitives/mementos/browser';

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

/**
 * Drops every persisted panel-layout entry that references a destroyed
 * split-pane group, so a later re-split (new group id) starts fresh from
 * defaults instead of accreting dead entries.
 *
 * Storage entry keys are library-internal
 * (`react-resizable-panels:${groupId}:${panelIds...}`), so an entry
 * references the pane group iff its `pane:${paneGroupId}` panel id appears as
 * a `:`-delimited segment. Pane group ids are UUIDs of fixed length, so a
 * substring match cannot hit a different group.
 */
export function deleteSplitPaneLayoutEntries(
  storage: Pick<MementoLayoutStorage, 'deleteEntry'>,
  entryKeys: readonly string[],
  paneGroupId: string
): void {
  const needle = `:${splitPanePanelId(paneGroupId)}`;
  for (const key of entryKeys) {
    if (key.includes(needle)) storage.deleteEntry(key);
  }
}
