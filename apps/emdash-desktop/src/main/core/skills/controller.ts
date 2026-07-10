import type { CLIAgentPluginProvider } from '@emdash/core/agents/plugins';
import type { DependencyId } from '@emdash/core/deps/runtime';
import type { SkillTargetSelection } from '@emdash/core/skills';
import { pluginRegistry } from '@emdash/plugins/agents';
import { localDependencyManager } from '@main/core/dependencies/dependency-managers';
import { skillsService } from '@main/core/skills/SkillsService';
import { log } from '@main/lib/logger';
import { createRPCController } from '@shared/lib/ipc/rpc';

export const skillsController = createRPCController({
  getProviders: async () => {
    const providers = pluginRegistry
      .getAll()
      .filter(
        (provider: CLIAgentPluginProvider) => provider.capabilities.skills.kind === 'supported'
      )
      .map((provider: CLIAgentPluginProvider) => ({
        id: provider.metadata.id,
        name: provider.metadata.name,
        installed:
          localDependencyManager.get(provider.metadata.id as DependencyId)?.status === 'available',
      }));
    return { success: true, data: providers };
  },

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

  searchSkillSh: async (args: { query: string }) => {
    try {
      const skills = await skillsService.searchSkillSh(args.query);
      return { success: true, data: skills };
    } catch (error) {
      log.error('Failed to search Skills.SH:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  install: async (args: { skillId: string; targets?: SkillTargetSelection }) => {
    try {
      const skill = await skillsService.installSkill(args.skillId, args.targets);
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

  setTargets: async (args: { installId: string; targets: SkillTargetSelection }) => {
    try {
      await skillsService.setTargets(args.installId, args.targets);
      return { success: true };
    } catch (error) {
      log.error('Failed to update skill targets:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  getDetail: async (args: { skillId: string }) => {
    try {
      const skill = await skillsService.getSkillDetail(args.skillId);
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to get skill detail:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },

  create: async (args: {
    name: string;
    description: string;
    content?: string;
    targets?: SkillTargetSelection;
  }) => {
    try {
      const skill = await skillsService.createSkill(
        args.name,
        args.description,
        args.content,
        args.targets
      );
      return { success: true, data: skill };
    } catch (error) {
      log.error('Failed to create skill:', error);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  },
});
