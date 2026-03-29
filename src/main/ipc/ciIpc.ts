import { ipcMain } from 'electron';
import { log } from '../lib/logger';
import { databaseService } from '../services/DatabaseService';

export function setupCiIpc(): void {
  ipcMain.handle('ci:triggerAgent', async (_, { taskId, initialPrompt, mode }) => {
    log.info('ci:triggerAgent', { taskId, mode });

    const task = await databaseService.getTaskById(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const metadata = task.metadata ? { ...task.metadata } : {};
    metadata.ciAutoFixPrompt = initialPrompt;
    metadata.ciAutoFixMode = mode;
    await databaseService.saveTask({
      ...task,
      metadata,
    });

    if (mode === 'auto') {
      return { status: 'triggered', taskId };
    } else {
      return { status: 'pending_approval', taskId };
    }
  });

  ipcMain.handle('ci:approveAutoFix', async (_, { taskId }) => {
    const task = await databaseService.getTaskById(taskId);

    if (!task?.metadata?.ciAutoFixPrompt) {
      throw new Error('No pending auto-fix for this task');
    }

    return { initialPrompt: task.metadata.ciAutoFixPrompt };
  });

  ipcMain.handle('ci:getPendingAutoFix', async (_, { taskId }) => {
    const task = await databaseService.getTaskById(taskId);

    if (!task?.metadata?.pendingCiFixes) {
      return null;
    }

    return {
      pendingFixes: task.metadata.pendingCiFixes,
      mode: task.metadata.ciAutoFixMode,
    };
  });

  ipcMain.handle('ci:clearPendingAutoFix', async (_, { taskId }) => {
    const task = await databaseService.getTaskById(taskId);

    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const metadata = task.metadata ? { ...task.metadata } : {};
    delete metadata.pendingCiFixes;
    delete metadata.ciAutoFixPrompt;
    delete metadata.ciAutoFixMode;
    delete metadata.ciAutoFixTriggeredAt;

    await databaseService.saveTask({
      ...task,
      metadata,
    });

    return { success: true };
  });
}
