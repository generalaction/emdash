import z from 'zod';
import { definePluginCapability } from '../../../lib/plugins/capability';
import type { PluginFs } from '../../runtime/fs';

export const HOOK_EVENTS = [
  'notification',
  'stop',
  'session',
  'start',
  'tool-use',
  'tool-use-failure',
] as const;

export type HookEvent = (typeof HOOK_EVENTS)[number];

export type HookRegistration = {
  event: string;
  command: string;
};

export type IHooksBehavior = {
  readHooks(fs: PluginFs): Promise<HookRegistration[]>;
  writeHooks(fs: PluginFs, hooks: HookRegistration[]): Promise<void>;
  deleteHooks(fs: PluginFs): Promise<void>;
  getHooksInstalled(fs: PluginFs): Promise<boolean>;
};

/**
 * hooksDescriptor is used to describe the hooks that an agent supports.
 * @param kind - The kind of hooks descriptor.
 * @param kind: 'supported' - The agent supports hooks.
 * @param kind: 'none' - The agent does not support hooks.
 * @param hookEvents - The events that the agent supports.
 */
export const hooksCapability = definePluginCapability<IHooksBehavior>()(
  'hooks',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('config'),
      scope: z.enum(['global', 'workspace']),
      supportedEvents: z.array(z.enum(HOOK_EVENTS)),
    }),
    z.object({
      kind: z.literal('plugin'),
      scope: z.enum(['workspace']),
      supportedEvents: z.array(z.enum(HOOK_EVENTS)),
    }),
    z.object({
      kind: z.literal('none'),
    }),
  ])
);
