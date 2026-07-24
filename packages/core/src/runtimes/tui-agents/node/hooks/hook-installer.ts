import type { Logger } from '@emdash/shared/logger';
import type { AgentPluginHost } from '@services/agent-plugins/api/plugins';
import { createLocalPluginFs } from '@services/agent-plugins/api/plugins/helpers';
import { ensureGitIgnoreEntries } from './gitignore';
import type { HookInstallPolicy } from './types';

export type TuiHookInstallerOptions = {
  agentHost: AgentPluginHost;
  logger: Logger;
};

export class TuiHookInstaller {
  constructor(private readonly options: TuiHookInstallerOptions) {}

  async ensureHooksInstalled(params: {
    providerId: string;
    workspacePath: string;
    policy?: HookInstallPolicy;
  }): Promise<boolean> {
    try {
      const plugin = this.options.agentHost.get(params.providerId);
      const hooksDescriptor = plugin?.capabilities.hooks;
      if (!plugin || !hooksDescriptor || hooksDescriptor.kind === 'none') return false;

      let writtenPaths: string[] = [];
      let hooksAvailable = false;

      if (hooksDescriptor.kind === 'config' && plugin.behavior.hooks) {
        const root =
          hooksDescriptor.scope === 'global'
            ? this.options.agentHost.homeDir
            : params.workspacePath;
        const fs = createLocalPluginFs(root);
        writtenPaths = await plugin.behavior.hooks.writeHooks(fs, []);
        hooksAvailable = true;
        if (hooksDescriptor.scope === 'global') writtenPaths = [];
      } else if (hooksDescriptor.kind === 'plugin' && plugin.behavior.plugins) {
        const fs = createLocalPluginFs(params.workspacePath);
        writtenPaths = await plugin.behavior.plugins.installPlugin(fs, {
          kind: 'workspace',
          path: params.workspacePath,
        });
        hooksAvailable = true;
      }

      if (params.policy?.writeGitIgnoreEntries !== false && writtenPaths.length > 0) {
        await ensureGitIgnoreEntries(createLocalPluginFs(params.workspacePath), writtenPaths);
      }

      return hooksAvailable;
    } catch (error) {
      this.options.logger.warn('TuiHookInstaller: failed to ensure hooks installed', {
        providerId: params.providerId,
        workspacePath: params.workspacePath,
        error: String(error),
      });
      return false;
    }
  }
}
