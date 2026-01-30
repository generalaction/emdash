import { ipcMain } from 'electron';
import { lifecycleScriptsService } from './LifecycleScriptsService';
import { log } from '../lib/logger';

export function registerLifecycleIpc(): void {
  // Get setup script for a project (if configured)
  ipcMain.handle(
    'lifecycle:getSetupScript',
    async (
      _event,
      args: {
        projectPath: string;
      }
    ) => {
      try {
        const script = lifecycleScriptsService.getSetupScript(args.projectPath);
        return { success: true, script };
      } catch (error) {
        log.error('Failed to get setup script:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get environment variables for lifecycle scripts
  ipcMain.handle(
    'lifecycle:getEnv',
    async (
      _event,
      args: {
        taskId: string;
        taskName: string;
        taskBranch?: string;
        worktreePath: string;
        projectPath: string;
      }
    ) => {
      try {
        const env = lifecycleScriptsService.buildEnv(
          {
            id: args.taskId,
            name: args.taskName,
            branch: args.taskBranch,
          },
          args.worktreePath,
          args.projectPath
        );
        return { success: true, env };
      } catch (error) {
        log.error('Failed to get lifecycle env:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
