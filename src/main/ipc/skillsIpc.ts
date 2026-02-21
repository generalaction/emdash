import { ipcMain } from 'electron';
import { skillsService } from '../services/SkillsService';
import { log } from '../lib/logger';

export function registerSkillsIpc(): void {
  ipcMain.handle('skills:getCatalog', async () => {
    try {
      const catalog = await skillsService.getCatalogIndex();
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to get skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('skills:refreshCatalog', async () => {
    try {
      const catalog = await skillsService.refreshCatalog();
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to refresh skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('skills:install', async (_, args: { skillId: string }) => {
    try {
      const skill = await skillsService.installSkill(args.skillId);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to install skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('skills:uninstall', async (_, args: { skillId: string }) => {
    try {
      await skillsService.uninstallSkill(args.skillId);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('skills:getDetail', async (_, args: { skillId: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to get skill detail:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('skills:getDetectedAgents', async () => {
    try {
      const agents = await skillsService.getDetectedAgents();
      return { success: true, data: agents };
    } catch (error) {
      log.error('Failed to detect agents:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle(
    'skills:create',
    async (_, args: { name: string; description: string; content?: string }) => {
      try {
        const skill = await skillsService.createSkill(args.name, args.description, args.content);
        return { success: true, data: skill };
      } catch (error) {
        log.error('Failed to create skill:', error);
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  );
}
