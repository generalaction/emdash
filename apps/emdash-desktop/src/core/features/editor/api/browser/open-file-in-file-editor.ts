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
} from '@core/primitives/desktop-runtime/api';
import { log } from '@core/primitives/logging/browser/logger';

/**
 * Resolves an agent's path spelling — relative, subdirectory-relative, or
 * absolute — against the task's workspace root into a canonical identity on
 * the task's host. Paths outside the workspace are ordinary absolute
 * HostFileRefs on the same host (spec §5/§10); null only for spellings that
 * cannot form a path at all.
 */
function resolveTaskFileRef(
  workspacePath: string,
  sshConnectionId: string | undefined,
  filePath: string
): HostFileRef | null {
  try {
    const root = hostPathFromNative(workspacePath);
    const resolved = absoluteRuntimePath(root, filePath);
    return hostFileRefFromNativePath(nativePathFromHost(resolved), sshConnectionId);
  } catch {
    return null;
  }
}

/**
 * Thin adapter over the {@link openFile} seam for callers that carry task ids
 * and possibly-relative paths (chat links, command palette). Pure resolution +
 * open: no existence precheck — a link to a missing file opens a tab showing
 * the store's not-found placeholder, which auto-recovers once the file is
 * created.
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
  const ref = resolveTaskFileRef(workspace.path, workspace.sshConnectionId, filePath);
  if (ref === null) {
    log.warn('[openFileInTaskEditor] Unresolvable file path:', filePath);
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

/**
 * Chat/terminal-slice sugar over the seam (spec §10): file links resolve at
 * this edge and open through {@link openFile}; the explicit "open external"
 * affordance hands off to the OS via {@link openWithOS}.
 */
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
