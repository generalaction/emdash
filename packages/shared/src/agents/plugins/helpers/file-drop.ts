import type { PluginFs } from '../../runtime/fs';
import type { PluginScope } from '../capabilities/plugins';

export function createFileDropPlugin(opts: {
  relativePath: string;
  content: string | ((ctx: { platform: NodeJS.Platform }) => string);
}) {
  const getContent = typeof opts.content === 'string' ? () => opts.content as string : opts.content;

  return {
    async installPlugin(fs: PluginFs, _scope: PluginScope): Promise<void> {
      const content = getContent({ platform: process.platform });
      await fs.write(opts.relativePath, content);
    },
    async uninstallPlugin(fs: PluginFs, _scope: PluginScope): Promise<void> {
      await fs.delete(opts.relativePath);
    },
    async isPluginInstalled(fs: PluginFs, _scope: PluginScope): Promise<boolean> {
      return fs.exists(opts.relativePath);
    },
    async getPluginVersion(_fs: PluginFs, _scope: PluginScope): Promise<string> {
      return '1.0.0';
    },
    async getPluginPath(_fs: PluginFs, _scope: PluginScope): Promise<string> {
      return opts.relativePath;
    },
  };
}
