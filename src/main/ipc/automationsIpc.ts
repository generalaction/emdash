import { app, BrowserWindow, ipcMain } from 'electron';
import { automationsService } from '../services/AutomationsService';
import { databaseService } from '../services/DatabaseService';
import { log } from '../lib/logger';
import type {
  Automation,
  CreateAutomationInput,
  UpdateAutomationInput,
} from '../../shared/automations/types';

// ---------------------------------------------------------------------------
// Trigger queue — buffers triggers when no renderer window is available
// ---------------------------------------------------------------------------
interface QueuedTrigger {
  automation: Automation;
  runLogId: string;
}

const triggerQueue: QueuedTrigger[] = [];

/** Send an automation trigger event to a renderer window, or queue it */
function sendTriggerToRenderer(automation: Automation, runLogId: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (target && !target.isDestroyed()) {
    target.webContents.send('automation:trigger', { ...automation, _runLogId: runLogId });
  } else {
    log.warn(
      `[Automations] No window available — queuing trigger for "${automation.name}" (runLog: ${runLogId})`
    );
    triggerQueue.push({ automation, runLogId });
  }
}

/** Flush any queued triggers to the first available window */
function flushTriggerQueue(): void {
  if (triggerQueue.length === 0) return;
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (!target || target.isDestroyed()) return;

  log.info(`[Automations] Flushing ${triggerQueue.length} queued trigger(s)`);
  while (triggerQueue.length > 0) {
    const item = triggerQueue.shift()!;
    target.webContents.send('automation:trigger', {
      ...item.automation,
      _runLogId: item.runLogId,
    });
  }
}

export function registerAutomationsIpc(): void {
  // Wire up the scheduler to send triggers to the renderer
  automationsService.onTrigger((automation, runLogId) => {
    log.info(`[Automations] Sending trigger to renderer for: ${automation.name}`);
    sendTriggerToRenderer(automation, runLogId);
  });

  // Reconcile missed runs (app was closed during scheduled time) then start
  void automationsService.reconcileMissedRuns().then(() => {
    automationsService.start();
  });

  // Stop scheduler on app quit
  app.on('before-quit', () => {
    automationsService.stop();
  });

  // Flush queued triggers when a new window appears
  app.on('browser-window-created', () => {
    // Small delay to let the window finish loading
    setTimeout(() => flushTriggerQueue(), 2000);
  });

  // -----------------------------------------------------------------------
  // CRUD handlers
  // -----------------------------------------------------------------------

  ipcMain.handle('automations:list', async () => {
    try {
      const automations = await automationsService.list();
      return { success: true, data: automations };
    } catch (error) {
      log.error('Failed to list automations:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('automations:get', async (_, args: { id: string }) => {
    try {
      const automation = await automationsService.get(args.id);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to get automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('automations:create', async (_, args: CreateAutomationInput) => {
    try {
      // Resolve the project name from the DB and validate the project exists
      const projects = await databaseService.getProjects();
      const project = projects.find((p) => p.id === args.projectId);
      if (!project) {
        return { success: false, error: `Unknown projectId: ${args.projectId}` };
      }

      // Set projectName directly — no separate call needed
      const automation = await automationsService.create({
        ...args,
        projectName: project.name,
      });
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to create automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('automations:update', async (_, args: UpdateAutomationInput) => {
    try {
      const automation = await automationsService.update(args);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to update automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('automations:delete', async (_, args: { id: string }) => {
    try {
      const deleted = await automationsService.delete(args.id);
      return { success: true, data: deleted };
    } catch (error) {
      log.error('Failed to delete automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('automations:toggle', async (_, args: { id: string }) => {
    try {
      const automation = await automationsService.toggleStatus(args.id);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to toggle automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'automations:runLogs',
    async (_, args: { automationId: string; limit?: number }) => {
      try {
        const logs = await automationsService.getRunLogs(args.automationId, args.limit);
        return { success: true, data: logs };
      } catch (error) {
        log.error('Failed to get automation run logs:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );

  ipcMain.handle('automations:triggerNow', async (_, args: { id: string }) => {
    try {
      const automation = await automationsService.get(args.id);
      if (!automation) {
        return { success: false, error: 'Automation not found' };
      }
      log.info(`[Automations] Manual trigger for: ${automation.name} (${automation.id})`);

      // Create a run log for the manual trigger
      const runLogId = await automationsService.createManualRunLog(automation.id);

      // Send trigger to renderer so it creates a task
      sendTriggerToRenderer(automation, runLogId);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to trigger automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  // -----------------------------------------------------------------------
  // Run completion tracking — renderer reports back when a run finishes
  // -----------------------------------------------------------------------

  ipcMain.handle(
    'automations:completeRun',
    async (
      _,
      args: {
        runLogId: string;
        automationId: string;
        taskId?: string;
        status: 'success' | 'failure';
        error?: string;
      }
    ) => {
      try {
        // Update the run log
        await automationsService.updateRunLog(args.runLogId, {
          status: args.status,
          finishedAt: new Date().toISOString(),
          taskId: args.taskId ?? null,
          error: args.error ?? null,
        });

        // Update the automation's last result
        await automationsService.setLastRunResult(args.automationId, args.status, args.error);

        return { success: true };
      } catch (error) {
        log.error('Failed to complete automation run:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
