import { ipcMain } from 'electron';
import { worktreeService } from './WorktreeService';
import { worktreePoolService } from './WorktreePoolService';

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
        baseRef?: string;
      }
    ) => {
      try {
        const worktree = await worktreeService.createWorktree(
          args.projectPath,
          args.taskName,
          args.projectId,
          args.autoApprove,
          args.baseRef
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
      }
    ) => {
      try {
        await worktreeService.removeWorktree(
          args.projectPath,
          args.worktreeId,
          args.worktreePath,
          args.branch
        );
        return { success: true };
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

  // Ensure a reserve worktree exists for a project (background operation)
  ipcMain.handle(
    'worktree:ensureReserve',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
        baseRef?: string;
      }
    ) => {
      try {
        // Fire and forget - don't await, just start the process
        worktreePoolService.ensureReserve(args.projectId, args.projectPath, args.baseRef);
        return { success: true };
      } catch (error) {
        console.error('Failed to ensure reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Check if a reserve is available for a project
  ipcMain.handle(
    'worktree:hasReserve',
    async (event, args: { projectId: string }) => {
      try {
        const hasReserve = worktreePoolService.hasReserve(args.projectId);
        return { success: true, hasReserve };
      } catch (error) {
        console.error('Failed to check reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Claim a reserve worktree for a new task (instant operation)
  ipcMain.handle(
    'worktree:claimReserve',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
        taskName: string;
        baseRef?: string;
        autoApprove?: boolean;
      }
    ) => {
      try {
        const result = await worktreePoolService.claimReserve(
          args.projectId,
          args.projectPath,
          args.taskName,
          args.baseRef,
          args.autoApprove
        );
        if (result) {
          return {
            success: true,
            worktree: result.worktree,
            needsBaseRefSwitch: result.needsBaseRefSwitch,
          };
        }
        return { success: false, error: 'No reserve available' };
      } catch (error) {
        console.error('Failed to claim reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Remove reserve for a project (cleanup)
  ipcMain.handle(
    'worktree:removeReserve',
    async (event, args: { projectId: string }) => {
      try {
        await worktreePoolService.removeReserve(args.projectId);
        return { success: true };
      } catch (error) {
        console.error('Failed to remove reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
