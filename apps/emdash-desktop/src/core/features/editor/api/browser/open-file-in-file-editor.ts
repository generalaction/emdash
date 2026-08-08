import type { HostFileRef } from '@emdash/core/primitives/path/api';
import {
  asProvisioned,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { openFile } from '@core/features/workbench/api/browser/open-file';
import { openWithOS } from '@core/features/workbench/api/browser/open-with-os';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import {
  absoluteRuntimePath,
  hostFileRefFromNativePath,
  hostPathFromNative,
  nativePathFromHost,
  relativePathWithin,
} from '@core/primitives/desktop-runtime/api';

/**
 * Resolves a task-relative or absolute path against the task's workspace and
 * returns its canonical identity, or null when the path escapes the workspace
 * (which routes to the external-file path instead).
 */
function resolveWorkspaceFileRef(
  workspacePath: string,
  sshConnectionId: string | undefined,
  filePath: string
): HostFileRef | null {
  try {
    const root = hostPathFromNative(workspacePath);
    const resolved = absoluteRuntimePath(root, filePath);
    relativePathWithin(root, resolved);
    return hostFileRefFromNativePath(nativePathFromHost(resolved), sshConnectionId);
  } catch {
    return null;
  }
}

/**
 * Thin adapter over the {@link openFile} seam for callers that carry task ids
 * and possibly-relative paths (chat links, command palette; ticket 11 reworks
 * chat links to carry HostFileRefs directly). No existence precheck: a missing
 * file opens as a tab showing the store's not-found placeholder.
 */
export async function openFileInTaskEditor(
  projectId: string,
  taskId: string,
  filePath: string,
  options: { target?: 'active' | 'right' } = {}
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;
  const workspace = workspaceRegistry.get(provisioned.workspaceId);
  if (!workspace) return;
  const ref = resolveWorkspaceFileRef(workspace.path, workspace.sshConnectionId, filePath);
  if (ref === null) {
    void openWithOS(filePath);
    return;
  }

  openFile(ref, {
    context: { projectId, taskId },
    target: options.target ?? 'active',
    reveal: true,
  });
}

/**
 * Opens a file in the pane immediately to the right of the currently focused
 * pane. If no right pane exists it is created by splitting. Intended for
 * diff-header clicks so the file appears beside the chat without replacing the
 * active editor tab.
 */
export async function openFileInAdjacentPane(
  projectId: string,
  taskId: string,
  filePath: string
): Promise<void> {
  return openFileInTaskEditor(projectId, taskId, filePath, { target: 'right' });
}

export function makeFileLinkHandlers(
  projectId: string,
  taskId: string
): { onOpenFile: (filePath: string) => void; onOpenExternal: (filePath: string) => void } {
  return {
    onOpenFile: (filePath) => {
      void openFileInTaskEditor(projectId, taskId, filePath);
    },
    onOpenExternal: (filePath) => {
      void openWithOS(filePath);
    },
  };
}
