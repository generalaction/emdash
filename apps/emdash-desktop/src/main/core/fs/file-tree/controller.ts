import type { NodeId } from '@emdash/core/files';
import { err, ok } from '@emdash/shared';
import { resolveWorkspace } from '@main/core/projects/utils';
import type { FileTreeMutationResult, FileTreeSnapshotResult } from '@shared/core/fs/file-tree';
import { createRPCController } from '@shared/lib/ipc/rpc';

export const fileTreeController = createRPCController({
  getSnapshot: async (projectId: string, workspaceId: string): Promise<FileTreeSnapshotResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return await workspace.fileTree.getSnapshot();
  },

  expandDir: async (
    projectId: string,
    workspaceId: string,
    dirId: NodeId | null
  ): Promise<FileTreeMutationResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const result = await workspace.fileTree.expandDir(dirId);
    return result.success ? ok({ sequences: result.data }) : err(result.error);
  },

  revealPath: async (
    projectId: string,
    workspaceId: string,
    filePath: string
  ): Promise<FileTreeMutationResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    const result = await workspace.fileTree.revealPath(filePath);
    return result.success ? ok({ sequences: result.data }) : err(result.error);
  },

  refresh: async (projectId: string, workspaceId: string): Promise<FileTreeSnapshotResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return await workspace.fileTree.refresh();
  },
});
