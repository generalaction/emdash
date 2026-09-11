import type { HostFileRef } from '@emdash/core/primitives/path/api';
import { toast } from '@emdash/ui/react/primitives';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import {
  asProvisioned,
  getTaskStore,
} from '@core/features/tasks/api/browser/task-state/task-selectors';
import { openFile } from '@core/features/workbench/api/browser/open-file';
import { openWithOS } from '@core/features/workbench/api/browser/open-with-os';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { workspaceRegistry } from '@core/features/workspaces/api/browser/stores/workspace-registry';
import { relativeToWorkspace } from '@core/features/workspaces/api/browser/workspace-path';
import { getHostClient } from '@core/primitives/desktop-host/browser/host-client';
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
  options: { target?: 'active' | 'right'; line?: number } = {}
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

  const opened = openFile(ref, {
    context: { projectId, taskId },
    target: options.target ?? 'active',
    reveal: true,
  });
  if (!opened || options.line === undefined) return;

  const resource = getTaskComposition(
    projectId,
    taskId
  )?.paneLayout.focusedPane.activeResourceOfKind<FileTabResource>('file');
  resource?.requestSelection({
    lineNumber: Math.max(1, Math.trunc(options.line)),
    startColumn: 1,
    endColumn: 1,
  });
}

/**
 * Opens a file in the pane immediately to the right of the currently focused
 * pane. If no right pane exists it is created by splitting. Intended for chat
 * file affordances so the file appears beside the transcript without replacing
 * it.
 */
export async function openFileInAdjacentPane(
  projectId: string,
  taskId: string,
  filePath: string,
  options: { line?: number } = {}
): Promise<void> {
  return openFileInTaskEditor(projectId, taskId, filePath, { ...options, target: 'right' });
}

/**
 * Terminal sugar over the seam (spec §10). Callers choose the pane target;
 * the explicit "open external" affordance hands off to the OS via
 * {@link openWithOS}.
 */
export function makeFileLinkHandlers(
  projectId: string,
  taskId: string,
  options: { target?: 'active' | 'right' } = {}
): { onOpenFile: (filePath: string) => void; onOpenExternal: (filePath: string) => void } {
  return {
    onOpenFile: (filePath) => {
      void openFileInTaskEditor(projectId, taskId, filePath, options);
    },
    onOpenExternal: (filePath) => {
      const provisioned = asProvisioned(getTaskStore(projectId, taskId));
      if (!provisioned) return;
      const workspace = workspaceRegistry.get(provisioned.workspaceId);
      if (!workspace) return;
      const ref = resolveTaskFileRef(workspace.path, workspace.sshConnectionId, filePath);
      if (ref) void openWithOS(ref);
    },
  };
}

/**
 * Session-scoped terminal link actions over the same resolution path as
 * {@link makeFileLinkHandlers}. `rawPath` is the path spelling seen in the
 * terminal; :line suffixes open the file at that line. Show-in-Explorer is a
 * workspace-scoped reveal via the host contract, so it never receives an
 * un-validated absolute path.
 */
export function makeTerminalLinkActions(
  projectId: string,
  taskId: string,
  options: { openInBrowser?: (url: string) => void } = {}
): {
  openFileInEditor: (rawPath: string) => void;
  showInFileManager: (rawPath: string) => void;
  openInBrowser?: (url: string) => void;
} {
  const resolveWorkspace = () => {
    const provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (!provisioned) return null;
    return workspaceRegistry.get(provisioned.workspaceId) ?? null;
  };

  return {
    openFileInEditor: (rawPath) => {
      void openFileInTaskEditor(projectId, taskId, rawPath);
    },
    showInFileManager: (rawPath) => {
      const workspace = resolveWorkspace();
      if (!workspace) return;
      if (workspace.sshConnectionId !== undefined) {
        toast.error('Show in Explorer is only available for local workspaces');
        return;
      }
      const ref = resolveTaskFileRef(workspace.path, workspace.sshConnectionId, rawPath);
      if (!ref) {
        log.warn('[makeTerminalLinkActions] Unresolvable file path:', rawPath);
        return;
      }
      void revealTaskFile(workspace.workspaceId, workspace.path, nativePathFromHost(ref.path));
    },
    openInBrowser: options.openInBrowser,
  };
}

/**
 * Reveals a resolved task file through the workspace reveal procedure. The
 * workspace-relative spelling keeps main-side validation intact; files outside
 * the workspace come back as an invalid-path error and surface as a toast.
 */
async function revealTaskFile(
  workspaceId: string,
  workspacePath: string,
  resolvedNativePath: string
): Promise<void> {
  try {
    const result = await (
      await getHostClient()
    ).showWorkspaceItemInFolder({
      workspaceId,
      relativePath: relativeToWorkspace(workspacePath, resolvedNativePath),
    });
    if (!result.success) {
      toast.error('Show failed', {
        description: result.error ?? 'The item could not be shown.',
      });
    }
  } catch (error) {
    toast.error('Show failed', {
      description: error instanceof Error ? error.message : 'The item could not be shown.',
    });
  }
}
