
import type { CLIAgentPluginFs } from '../core/plugin';
import type { PluginScope } from '../core/capabilities';

export function createFileDropPlugin(opts: {
  relativePath: string;
  content: string | ((ctx: { platform: NodeJS.Platform }) => string);
}) {
  const getContent = typeof opts.content === 'string'
    ? () => opts.content as string
    : opts.content;

  return {
    async installPlugin(fs: CLIAgentPluginFs, scope: PluginScope) {
      const content = getContent({ platform: process.platform });
      await fs.write(opts.relativePath, content);
    },
    async uninstallPlugin(fs: CLIAgentPluginFs, scope: PluginScope) {
      await fs.delete(opts.relativePath);
    },
    async isPluginInstalled(fs: CLIAgentPluginFs, scope: PluginScope) {
      return fs.exists(opts.relativePath);
    },
    async getPluginPath(_fs: CLIAgentPluginFs, _scope: PluginScope) {
      return opts.relativePath;
    },
  };
}