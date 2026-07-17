import type { NodeId } from '@emdash/core/files';
import { err, ok } from '@emdash/shared';
import { resolveWorkspace } from '@main/core/projects/utils';
import type {
  FileTreeProjectionCloseResult,
  FileTreeProjectionOpenResult,
  FileTreeProjectionVersionResult,
} from '@shared/core/fs/file-tree';
import { createRPCController } from '@shared/lib/ipc/rpc';

export const fileTreeController = createRPCController({
  openProjection: async (
    projectId: string,
    workspaceId: string
  ): Promise<FileTreeProjectionOpenResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return await workspace.fileTreeProjector.openProjection();
  },

  registerDir: async (
    projectId: string,
    workspaceId: string,
    subscriptionId: string,
    dirId: NodeId | null
  ): Promise<FileTreeProjectionVersionResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return await workspace.fileTreeProjector.registerDir(subscriptionId, dirId);
  },

  revealPath: async (
    projectId: string,
    workspaceId: string,
    subscriptionId: string,
    filePath: string
  ): Promise<FileTreeProjectionVersionResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    return await workspace.fileTreeProjector.revealPath(subscriptionId, filePath);
  },

  closeProjection: async (
    projectId: string,
    workspaceId: string,
    subscriptionId: string
  ): Promise<FileTreeProjectionCloseResult> => {
    const workspace = resolveWorkspace(projectId, workspaceId);
    if (!workspace) return err({ type: 'not_found' });
    await workspace.fileTreeProjector.closeProjection(subscriptionId);
    return ok<void>();
  },
});
