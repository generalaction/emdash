import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';
import type { PluginFs } from '../../runtime/fs';

export type PluginScope = { kind: 'global' } | { kind: 'workspace'; path: string };

export type IPlugins = {
  installPlugin(fs: PluginFs, scope: PluginScope): Promise<void>;
  uninstallPlugin(fs: PluginFs, scope: PluginScope): Promise<void>;
  isPluginInstalled(fs: PluginFs, scope: PluginScope): Promise<boolean>;
  getPluginVersion(fs: PluginFs, scope: PluginScope): Promise<string>;
  getPluginPath(fs: PluginFs, scope: PluginScope): Promise<string>;
};

export const pluginsCapability = definePluginCapability<IPlugins>()(
  'plugin',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('file-drop'),
      scope: z.literal('workspace'),
    }),
    z.object({
      kind: z.literal('cli'),
    }),
    z.object({
      kind: z.literal('none'),
    }),
  ])
);