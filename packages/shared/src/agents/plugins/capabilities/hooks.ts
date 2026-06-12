import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';
import type { PluginFs } from '../../runtime/fs';
import type { HookRegistration } from './hooks-types';

export type { HookRegistration };
export type { HookEvent } from './hooks-types';
export { HOOK_EVENTS } from './hooks-types';

export type IHooksBehavior = {
  readHooks(fs: PluginFs): Promise<HookRegistration[]>;
  writeHooks(fs: PluginFs, hooks: HookRegistration[]): Promise<void>;
  deleteHooks(fs: PluginFs): Promise<void>;
  getHooksInstalled(fs: PluginFs): Promise<boolean>;
};

/**
 * hooksDescriptor is used to describe the hooks that an agent supports.
 *
 * kind: 'config'  — hooks written into agent config file(s)
 * kind: 'plugin'  — hooks delivered via a dropped file/plugin
 * kind: 'none'    — agent does not support lifecycle hooks
 */
export const hooksCapability = definePluginCapability<IHooksBehavior>()(
  'hooks',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('config'),
      scope: z.enum(['global', 'workspace']),
      supportedEvents: z.array(
        z.enum(['notification', 'stop', 'session', 'start', 'tool-use', 'tool-use-failure'])
      ),
    }),
    z.object({
      kind: z.literal('plugin'),
      scope: z.enum(['global', 'workspace']),
      supportedEvents: z.array(
        z.enum(['notification', 'stop', 'session', 'start', 'tool-use', 'tool-use-failure'])
      ),
    }),
    z.object({ kind: z.literal('none') }),
  ])
);
