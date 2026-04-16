import { createRPCController } from '@/shared/ipc/rpc';
import { skillsService, type SkillsShBrowseKind } from '@main/core/skills/SkillsService';
import { log } from '@main/lib/logger';

export const skillsController = createRPCController({
  getCatalog: async () => {
    try {
      const catalog = await skillsService.getCatalogIndex();
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to get skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  refreshCatalog: async () => {
    try {
      const catalog = await skillsService.refreshCatalog();
      return { success: true, data: catalog };
    } catch (error) {
      log.error('Failed to refresh skills catalog:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  install: async (args: { skillId: string; source?: { owner: string; repo: string } }) => {
    try {
      const skill = await skillsService.installSkill(args.skillId, args.source);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to install skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  uninstall: async (args: { skillId: string }) => {
    try {
      await skillsService.uninstallSkill(args.skillId);
      return { success: true };
    } catch (error) {
      log.error('Failed to uninstall skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetail: async (args: { skillId: string; source?: { owner: string; repo: string } }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId, args.source);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to get skill detail:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  search: async (args: { query: string }) => {
    try {
      const results = await skillsService.searchSkillsSh(args.query);
      return { success: true, data: results };
    } catch (error) {
      log.error('Failed to search skills:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  browse: async (args: { kind: SkillsShBrowseKind }) => {
    try {
      const results = await skillsService.browseSkillsSh(args.kind);
      return { success: true, data: results };
    } catch (error) {
      log.error('Failed to browse skills.sh:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetectedAgents: async () => {
    try {
      const agents = await skillsService.getDetectedAgents();
      return { success: true, data: agents };
    } catch (error) {
      log.error('Failed to detect agents:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  create: async (args: { name: string; description: string; content?: string }) => {
    try {
      const skill = await skillsService.createSkill(args.name, args.description, args.content);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to create skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
