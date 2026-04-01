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
  assertOptionalString(a.projectId, 'projectId');
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

function validateRunLogsArg(
  args: unknown
): asserts args is { automationId: string; limit?: number } {
  if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
  const a = args as Record<string, unknown>;
  assertString(a.automationId, 'automationId');
  if (a.limit !== undefined && (typeof a.limit !== 'number' || a.limit <= 0)) {
    throw new Error('Invalid limit: expected positive number or undefined');
  }
}

function validateCompleteRunArg(args: unknown): asserts args is {
  runLogId: string;
  automationId: string;
  status: 'success' | 'failure';
  taskId?: string;
  error?: string;
} {
  if (!args || typeof args !== 'object') throw new Error('Invalid input: expected object');
  const a = args as Record<string, unknown>;
  assertString(a.runLogId, 'runLogId');
  assertString(a.automationId, 'automationId');
  if (a.status !== 'success' && a.status !== 'failure') {
    throw new Error('Invalid status: expected "success" or "failure"');
  }
  if (a.taskId !== undefined && typeof a.taskId !== 'string') {
    throw new Error('Invalid taskId: expected string or undefined');
  }
  if (a.error !== undefined && typeof a.error !== 'string') {
    throw new Error('Invalid error: expected string or undefined');
  }
}

// ---------------------------------------------------------------------------
// Trigger queue — always buffers, renderer pulls when ready.
// Triggers are queued and the renderer drains via automations:drainTriggers
// when its listener is ready. A push hint via webContents.send() tells the
// renderer to drain immediately.
// ---------------------------------------------------------------------------
interface QueuedTrigger {
  automation: Automation;
  runLogId: string;
}

const MAX_TRIGGER_QUEUE = 50;
const triggerQueue: QueuedTrigger[] = [];

/** Queue a trigger and notify the renderer to drain */
function sendTriggerToRenderer(automation: Automation, runLogId: string): void {
  // Always queue first
  if (triggerQueue.length >= MAX_TRIGGER_QUEUE) {
    const dropped = triggerQueue.shift()!;
    log.warn(
      `[Automations] Trigger queue full (${MAX_TRIGGER_QUEUE}) — dropping oldest: "${dropped.automation.name}"`
    );
    // Mark the dropped run log as failed so it doesn't stay orphaned
    void automationsService
      .updateRunLog(dropped.runLogId, {
        status: 'failure',
        finishedAt: new Date().toISOString(),
        error: 'Dropped due to trigger queue overflow',
      })
      .catch((err) => log.error('[Automations] Failed to mark dropped run log as failed:', err));
  }
  triggerQueue.push({ automation, runLogId });

  // Best-effort push notification — if the renderer is listening, it'll drain immediately
  const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  if (target && !target.isDestroyed()) {
    target.webContents.send('automation:trigger-available');
  }
}

export function registerAutomationsIpc(): void {
  // Wire up the scheduler to send triggers to the renderer
  automationsService.onTrigger((automation, runLogId) => {
    log.info(`[Automations] Sending trigger to renderer for: ${automation.name}`);
    sendTriggerToRenderer(automation, runLogId);
  });

  // Reconcile missed runs (app was closed during scheduled time) then start
  void automationsService
    .reconcileMissedRuns()
    .catch((error) => {
      log.error('Failed to reconcile missed automation runs:', error);
    })
    .finally(() => {
      automationsService.start();
    });

  // Stop scheduler on app quit
  app.on('before-quit', () => {
    automationsService.stop();
  });

  // Hint the renderer to drain when a new window is ready
  app.on('browser-window-created', (_, window) => {
    window.webContents.once('did-finish-load', () => {
      if (triggerQueue.length > 0) {
        window.webContents.send('automation:trigger-available');
      }
    });
  });

  // -----------------------------------------------------------------------
  // Pull-based trigger drain — renderer calls this when listener is ready
  // -----------------------------------------------------------------------
  ipcMain.handle('automations:drainTriggers', () => {
    if (triggerQueue.length === 0) return { success: true, data: [] };

    log.info(`[Automations] Draining ${triggerQueue.length} queued trigger(s)`);
    const items = triggerQueue.splice(0).map((item) => ({
      ...item.automation,
      _runLogId: item.runLogId,
    }));

    return { success: true, data: items };
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

      // If projectId is being changed, resolve and validate the new project
      if (args.projectId) {
        const projects = await databaseService.getProjects();
        const project = projects.find((p) => p.id === args.projectId);
        if (!project) {
          return { success: false, error: `Unknown projectId: ${args.projectId}` };
        }
        (args as unknown as Record<string, unknown>).projectName = project.name;
      }

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
      validateRunLogsArg(args);
      const limit = args.limit !== undefined ? Math.min(args.limit, 500) : undefined;
      const logs = await automationsService.getRunLogs(args.automationId, limit);
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
      if (automation.mode === 'trigger') {
        return {
          success: false,
          error: 'Run now is only available for scheduled automations',
        };
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
      validateCompleteRunArg(args);

      await automationsService.updateRunLog(args.runLogId, {
        status: args.status,
        finishedAt: new Date().toISOString(),
        taskId: args.taskId ?? null,
        error: args.error ?? null,
      });

      await automationsService.setLastRunResult(args.automationId, args.status, args.error);

      return { success: true };
    } catch (error) {
      log.error('Failed to complete automation run:', error);
      return { success: false, error: formatError(error) };
    }
  });
}
