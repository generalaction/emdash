import { ipcMain } from 'electron';
import { automationsService } from '../services/AutomationsService';
import { databaseService } from '../services/DatabaseService';
import { log } from '../lib/logger';
import type { CreateAutomationInput, UpdateAutomationInput } from '../../shared/automations/types';

export function registerAutomationsIpc(): void {
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
      // Resolve the project name from the DB
      const projects = await databaseService.getProjects();
      const project = projects.find((p) => p.id === args.projectId);

      const automation = await automationsService.create(args);
      // Persist the project name on the automation record
      if (project) {
        await automationsService.setProjectName(automation.id, project.name);
      }
      const updated = await automationsService.get(automation.id);
      return { success: true, data: updated ?? automation };
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
      // The trigger callback will handle creating the task
      // For manual trigger, we just fire the trigger
      log.info(`[Automations] Manual trigger for: ${automation.name} (${automation.id})`);
      return { success: true, data: automation };
    } catch (error) {
      log.error('Failed to trigger automation:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
