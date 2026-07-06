import { toast } from 'sonner';
import {
  asProvisioned,
  getTaskStore,
  getTaskView,
} from '@renderer/features/tasks/stores/task-selectors';
import { rpc } from '@renderer/lib/ipc';
import { focusTracker } from '@renderer/utils/focus-tracker';
import { resolveWorkspacePath } from './workspace-path';
import { workspaceRegistry } from './workspace-registry';

function isAbsolutePath(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath);
}

function isPathInsideWorkspace(workspacePath: string, filePath: string): boolean {
  const root = workspacePath.replace(/\\/g, '/').replace(/\/+$/, '');
  const path = filePath.replace(/\\/g, '/');
  return path === root || path.startsWith(`${root}/`);
}

function resolveEditorFilePath(workspacePath: string, filePath: string): string | null {
  const resolvedPath = resolveWorkspacePath(workspacePath, filePath);
  if (isAbsolutePath(filePath) && !isPathInsideWorkspace(workspacePath, resolvedPath)) {
    return null;
  }
  return resolvedPath;
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
  const exists = await rpc.workspace.files.fileExists(
    projectId,
    provisioned.workspaceId,
    resolvedPath
  );
  let openPath = resolvedPath;
  if (!exists.success || !exists.data.exists) {
    // Agents often reference files by bare name (`Notes.md`) without the
    // directory — fall back to a workspace file-index lookup.
    const indexed = isBareFilename(filePath)
      ? await findWorkspaceFileByName(provisioned.workspaceId, filePath)
      : null;
    if (indexed === null) {
      toast.error(`File not found in workspace: ${filePath}`);
      return;
    }
    openPath = resolveWorkspacePath(workspace.path, indexed);
  }

  focusTracker.transition({ mainPanel: 'editor' }, 'panel_switch');
  provisioned.viewModel?.activePane.open('file', { path: openPath }, { preview: false });
}

function isBareFilename(filePath: string): boolean {
  return !filePath.includes('/') && !filePath.includes('\\');
}

/**
 * Resolves a bare filename against the workspace file index. Returns the
 * workspace-relative path of the shallowest exact-name match, or null when
 * the name is unknown (e.g. a false-positive terminal link like `Node.js`).
 */
async function findWorkspaceFileByName(
  workspaceId: string,
  filename: string
): Promise<string | null> {
  const hits = await rpc.search.searchWorkspaceFiles({ workspaceId, query: filename, limit: 50 });
  const exact = hits.filter((h) => h.filename === filename);
  if (exact.length === 0) return null;
  exact.sort(
    (a, b) => a.path.split('/').length - b.path.split('/').length || a.path.localeCompare(b.path)
  );
  return exact[0].path;
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

  const exists = await rpc.workspace.files.fileExists(
    projectId,
    provisioned.workspaceId,
    resolvedPath
  );
  if (!exists.success || !exists.data.exists) {
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
