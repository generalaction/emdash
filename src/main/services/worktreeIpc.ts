import { ipcMain } from 'electron';
import { worktreeService } from './WorktreeService';

export function registerWorktreeIpc(): void {
  // Create a new worktree
  ipcMain.handle(
    'worktree:create',
    async (
      event,
      args: {
        projectPath: string;
        taskName: string;
        projectId: string;
        autoApprove?: boolean;
      }
    ) => {
      try {
        const worktree = await worktreeService.createWorktree(
          args.projectPath,
          args.taskName,
          args.projectId,
          args.autoApprove
        );
        return { success: true, worktree };
      } catch (error) {
        console.error('Failed to create worktree:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // List worktrees for a project
  ipcMain.handle('worktree:list', async (event, args: { projectPath: string }) => {
    try {
      const worktrees = await worktreeService.listWorktrees(args.projectPath);
      return { success: true, worktrees };
    } catch (error) {
      console.error('Failed to list worktrees:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Remove a worktree
  ipcMain.handle(
    'worktree:remove',
    async (
      event,
      args: {
        projectPath: string;
        worktreeId: string;
        worktreePath?: string;
        branch?: string;
        deleteRemoteBranch?: boolean;
      }
    ) => {
      try {
        const result = await worktreeService.removeWorktree(
          args.projectPath,
          args.worktreeId,
          args.worktreePath,
          args.branch,
          { deleteRemoteBranch: args.deleteRemoteBranch }
        );
        return { success: true, ...result };
      } catch (error) {
        console.error('Failed to remove worktree:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get worktree status
  ipcMain.handle('worktree:status', async (event, args: { worktreePath: string }) => {
    try {
      const status = await worktreeService.getWorktreeStatus(args.worktreePath);
      return { success: true, status };
    } catch (error) {
      console.error('Failed to get worktree status:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Merge worktree changes
  ipcMain.handle(
    'worktree:merge',
    async (
      event,
      args: {
        projectPath: string;
        worktreeId: string;
      }
    ) => {
      try {
        await worktreeService.mergeWorktreeChanges(args.projectPath, args.worktreeId);
        return { success: true };
      } catch (error) {
        console.error('Failed to merge worktree changes:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get worktree by ID
  ipcMain.handle('worktree:get', async (event, args: { worktreeId: string }) => {
    try {
      const worktree = worktreeService.getWorktree(args.worktreeId);
      return { success: true, worktree };
    } catch (error) {
      console.error('Failed to get worktree:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all worktrees
  ipcMain.handle('worktree:getAll', async () => {
    try {
      const worktrees = worktreeService.getAllWorktrees();
      return { success: true, worktrees };
    } catch (error) {
      console.error('Failed to get all worktrees:', error);
      return { success: false, error: (error as Error).message };
    }
  });
}
