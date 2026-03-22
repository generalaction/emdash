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
// Input validation helpers
// ---------------------------------------------------------------------------

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid ${field}: expected non-empty string`);
  }
}

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && (typeof value !== 'string' || value.length === 0)) {
    throw new Error(`Invalid ${field}: expected non-empty string or undefined`);
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function validateCreateInput(args: unknown): asserts args is CreateAutomationInput {
  if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
  const a = args as Record<string, unknown>;
  assertString(a.name, 'name');
  assertString(a.projectId, 'projectId');
  assertString(a.prompt, 'prompt');
  assertString(a.agentId, 'agentId');
  if (!a.schedule || typeof a.schedule !== 'object') {
    throw new Error('Invalid schedule: expected object');
  }
}

function validateUpdateInput(args: unknown): asserts args is UpdateAutomationInput {
  if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
  const a = args as Record<string, unknown>;
  assertString(a.id, 'id');
  assertOptionalString(a.name, 'name');
  assertOptionalString(a.prompt, 'prompt');
  assertOptionalString(a.agentId, 'agentId');
  if (a.schedule !== undefined && (typeof a.schedule !== 'object' || a.schedule === null)) {
    throw new Error('Invalid schedule: expected object or undefined');
  }
  if (a.useWorktree !== undefined && typeof a.useWorktree !== 'boolean') {
    throw new Error('Invalid useWorktree: expected boolean or undefined');
  }
}

function validateIdArg(args: unknown): asserts args is { id: string } {
  if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
  assertString((args as Record<string, unknown>).id, 'id');
}

// ---------------------------------------------------------------------------
// Trigger queue — buffers triggers when no renderer window is available
// ---------------------------------------------------------------------------
interface QueuedTrigger {
  automation: Automation;
  runLogId: string;
}

const MAX_TRIGGER_QUEUE = 50;
const triggerQueue: QueuedTrigger[] = [];

/** Send an automation trigger event to a renderer window, or queue it */
function sendTriggerToRenderer(automation: Automation, runLogId: string): void {
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (target && !target.isDestroyed()) {
    target.webContents.send('automation:trigger', { ...automation, _runLogId: runLogId });
  } else {
    if (triggerQueue.length >= MAX_TRIGGER_QUEUE) {
      const dropped = triggerQueue.shift()!;
      log.warn(
        `[Automations] Trigger queue full (${MAX_TRIGGER_QUEUE}) — dropping oldest: "${dropped.automation.name}"`
      );
    }
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

  // Flush queued triggers when a new window finishes loading
  app.on('browser-window-created', (_, window) => {
    window.webContents.once('did-finish-load', () => {
      flushTriggerQueue();
    });
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
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:get', async (_, args: unknown) => {
    try {
      validateIdArg(args);
      const automation = await automationsService.get(args.id);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to get automation:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:create', async (_, args: unknown) => {
    try {
      validateCreateInput(args);

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
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:update', async (_, args: unknown) => {
    try {
      validateUpdateInput(args);
      const automation = await automationsService.update(args);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to update automation:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:delete', async (_, args: unknown) => {
    try {
      validateIdArg(args);
      const deleted = await automationsService.delete(args.id);
      return { success: true, data: deleted };
    } catch (error) {
      log.error('Failed to delete automation:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:toggle', async (_, args: unknown) => {
    try {
      validateIdArg(args);
      const automation = await automationsService.toggleStatus(args.id);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to toggle automation:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:runLogs', async (_, args: unknown) => {
    try {
      if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
      const a = args as Record<string, unknown>;
      assertString(a.automationId, 'automationId');
      const limit = typeof a.limit === 'number' && a.limit > 0 ? Math.min(a.limit, 500) : undefined;
      const logs = await automationsService.getRunLogs(a.automationId as string, limit);
      return { success: true, data: logs };
    } catch (error) {
      log.error('Failed to get automation run logs:', error);
      return { success: false, error: formatError(error) };
    }
  });

  ipcMain.handle('automations:triggerNow', async (_, args: unknown) => {
    try {
      validateIdArg(args);
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
      return { success: false, error: formatError(error) };
    }
  });

  // -----------------------------------------------------------------------
  // Run completion tracking — renderer reports back when a run finishes
  // -----------------------------------------------------------------------

  ipcMain.handle('automations:completeRun', async (_, args: unknown) => {
    try {
      if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
      const a = args as Record<string, unknown>;
      assertString(a.runLogId, 'runLogId');
      assertString(a.automationId, 'automationId');
      if (a.status !== 'success' && a.status !== 'failure') {
        throw new Error('Invalid status: expected "success" or "failure"');
      }

      // Update the run log
      await automationsService.updateRunLog(a.runLogId as string, {
        status: a.status,
        finishedAt: new Date().toISOString(),
        taskId: typeof a.taskId === 'string' ? a.taskId : null,
        error: typeof a.error === 'string' ? a.error : null,
      });

      // Update the automation's last result
      await automationsService.setLastRunResult(
        a.automationId as string,
        a.status,
        typeof a.error === 'string' ? a.error : undefined
      );

      return { success: true };
    } catch (error) {
      log.error('Failed to complete automation run:', error);
      return { success: false, error: formatError(error) };
    }
  });
}
