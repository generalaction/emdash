import { toast } from 'sonner';
import {
  asProvisioned,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { workspaceRegistry } from '@renderer/features/tasks/stores/workspace-registry';
import { rpc } from '@renderer/lib/ipc';
import { focusTracker } from '@renderer/utils/focus-tracker';

// ── Path helpers ──────────────────────────────────────────────────────────────

export function isAbsolutePath(p: string): boolean {
  return p.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * Returns the path relative to `root`, or `null` when `absPath` is not under
 * `root`. Both paths are normalized to forward slashes before comparison so
 * POSIX and Windows separators are handled uniformly.
 */
function toWorkspaceRelative(absPath: string, root: string): string | null {
  const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
  const normAbs = absPath.replace(/\\/g, '/');
  if (normAbs === normRoot) return '';
  const prefix = `${normRoot}/`;
  return normAbs.startsWith(prefix) ? normAbs.slice(prefix.length) : null;
}

/**
 * If `filePath` is absolute and under the worktree root, return the
 * workspace-relative equivalent. If it is absolute but outside the root,
 * return null (caller should fall back to external open). Relative paths are
 * returned unchanged.
 */
function resolveWorkspacePath(
  filePath: string,
  projectId: string,
  workspaceId: string
): string | null {
  if (!isAbsolutePath(filePath)) return filePath;
  const root = workspaceRegistry.get(projectId, workspaceId)?.path;
  if (!root) return null;
  return toWorkspaceRelative(filePath, root);
}

// ── Open helpers ──────────────────────────────────────────────────────────────

export async function openFileInTaskEditor(
  projectId: string,
  taskId: string,
  filePath: string
): Promise<void> {
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  if (!provisioned) return;

  const relPath = resolveWorkspacePath(filePath, projectId, provisioned.workspaceId);
  if (relPath === null) {
    void openExternalFilePath(projectId, taskId, filePath);
    return;
  }

  // Agent output often points at paths that don't exist in the worktree
  // (subdirectory-relative, deleted, etc.) — precheck so we can toast a
  // useful error instead of opening an empty tab.
  const exists = await rpc.workspace.fs.fileExists(projectId, provisioned.workspaceId, relPath);
  if (!exists.success || !exists.data.exists) {
    toast.error(`File not found in workspace: ${filePath}`);
    return;
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.activePane.open('file', { path: relPath }, { preview: false });
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

  const relPath = resolveWorkspacePath(filePath, projectId, provisioned.workspaceId);
  if (relPath === null) {
    void openExternalFilePath(projectId, taskId, filePath);
    return;
  }

  const exists = await rpc.workspace.fs.fileExists(projectId, provisioned.workspaceId, relPath);
  if (!exists.success || !exists.data.exists) {
    toast.error(`File not found in workspace: ${filePath}`);
    return;
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.paneLayout.open(
    'file',
    { path: relPath },
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
