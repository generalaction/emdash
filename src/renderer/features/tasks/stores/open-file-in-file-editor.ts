import { toast } from 'sonner';
import {
  asProvisioned,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { focusTracker } from '@renderer/utils/focus-tracker';

export async function openFileInTaskEditor(
  projectId: string,
  taskId: string,
  filePath: string
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;

  // Agent output often points at paths that don't exist in the worktree
  // (subdirectory-relative, deleted, etc.) — precheck so we can toast a
  // useful error instead of opening an empty tab.
  const exists = await rpc.fs.fileExists(projectId, provisioned.workspaceId, filePath);
  if (!exists.success || !exists.data.exists) {
    toast.error(`File not found in workspace: ${filePath}`);
    return;
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.tabManager.openFile(filePath);
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
    void getTaskView(projectId, taskId)?.tabManager.openExternalFile(filePath);
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
