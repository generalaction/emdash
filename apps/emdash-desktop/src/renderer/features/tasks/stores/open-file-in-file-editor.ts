import { toast } from 'sonner';
import {
  asProvisioned,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { filesPath } from '@renderer/lib/runtime/files';
import { getFilesRuntimeClient } from '@renderer/lib/runtime/files-client';
import { focusTracker } from '@renderer/utils/focus-tracker';
import {
  absoluteRuntimePath,
  hostPathFromNative,
  nativePathFromHost,
  relativePathWithin,
} from '@shared/core/runtime/paths';
import { workspaceRegistry } from './workspace-registry';

function resolveEditorFilePath(workspacePath: string, filePath: string): string | null {
  try {
    const root = hostPathFromNative(workspacePath);
    const resolved = absoluteRuntimePath(root, filePath);
    relativePathWithin(root, resolved);
    return nativePathFromHost(resolved).replaceAll('\\', '/');
  } catch {
    return null;
  }
}

export async function openFileInTaskEditor(
  projectId: string,
  taskId: string,
  filePath: string
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;
  const workspace = workspaceRegistry.get(projectId, provisioned.workspaceId);
  if (!workspace) return;
  const resolvedPath = resolveEditorFilePath(workspace.path, filePath);
  if (resolvedPath === null) {
    void openExternalFilePath(projectId, taskId, filePath);
    return;
  }

  // Agent output often points at paths that don't exist in the worktree
  // (subdirectory-relative, deleted, etc.) — precheck so we can toast a
  // useful error instead of opening an empty tab.
  const files = await getFilesRuntimeClient();
  const exists = await files.fs.exists(filesPath(workspace.path, resolvedPath));
  if (!exists.success || !exists.data) {
    toast.error(`File not found in workspace: ${filePath}`);
    return;
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.activePane.open('file', { path: resolvedPath }, { preview: false });
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
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;
  const workspace = workspaceRegistry.get(projectId, provisioned.workspaceId);
  if (!workspace) return;

  const resolvedPath = resolveEditorFilePath(workspace.path, filePath);
  if (resolvedPath === null) {
    void openExternalFilePath(projectId, taskId, filePath);
    return;
  }

  const files = await getFilesRuntimeClient();
  const exists = await files.fs.exists(filesPath(workspace.path, resolvedPath));
  if (!exists.success || !exists.data) {
    toast.error(`File not found in workspace: ${filePath}`);
    return;
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.paneLayout.open(
    'file',
    { path: resolvedPath },
    { preview: false, target: 'right' }
  );
}

export async function openExternalFilePath(
  projectId: string,
  taskId: string,
  filePath: string
): Promise<void> {
  if (filePath.toLowerCase().endsWith('.md')) {
    const provisioned = asProvisioned(getTaskStore(projectId, taskId));
    if (!provisioned) return;
    focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
    getTaskView(projectId, taskId)?.activePane.open(
      'file',
      { path: filePath, external: true },
      { preview: false }
    );
    return;
  }
  const result = await rpc.app.openPath(filePath);
  if (!result.success) {
    toast.error(`Could not open ${filePath}: ${result.error}`);
  }
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
      void openExternalFilePath(projectId, taskId, filePath);
    },
  };
}
