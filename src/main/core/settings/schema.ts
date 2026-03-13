import { homedir } from 'node:os';
import { join } from 'node:path';
import z from 'zod';
import { DEFAULT_PROVIDER_ID, PROVIDER_IDS, PROVIDERS } from '@shared/agent-provider-registry';
import { openInAppIdSchema } from '@shared/openInApps';

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string().default(join(homedir(), 'emdash', 'projects')),
  defaultWorktreeDirectory: z.string().default(join(homedir(), 'emdash', 'worktrees')),
  branchPrefix: z.string().default('emdash'),
  pushOnCreate: z.boolean().default(true),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  sound: z.boolean().default(true),
  osNotifications: z.boolean().default(true),
  soundFocusMode: z.enum(['always', 'unfocused']).default('always'),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean().default(true),
  autoApproveByDefault: z.boolean().default(false),
  autoTrustWorktrees: z.boolean().default(true),
});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean().default(false),
});

export const themeSchema = z.enum(['light', 'dark', 'dark-black', 'system']).default('system');

export const defaultAgentSchema = z.enum(PROVIDER_IDS).default(DEFAULT_PROVIDER_ID);

export const keyboardSettingsSchema = z.record(z.string(), z.string()).default({
  cmdk: 'Mod+K',
  settings: 'Mod+,',
  toggleLeftSidebar: 'Mod+B',
  toggleRightSidebar: 'Mod+.',
  toggleConversations: 'Mod+A',
  toggleEditor: 'Mod+E',
  tabsNext: 'Mod+Shift+ArrowRight',
  tabsPrev: 'Mod+Shift+ArrowLeft',
  newTask: 'Mod+N',
  newProject: 'Mod+Shift+N',
});

export const providerCustomConfigEntrySchema = z.object({
  cli: z.string().optional(),
  resumeFlag: z.string().optional(),
  defaultArgs: z.array(z.string()).optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  sessionIdFlag: z.string().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const providerConfigDefaults = Object.fromEntries(
  PROVIDERS.filter(
    (p) => p.cli || p.resumeFlag || p.autoApproveFlag || p.initialPromptFlag || p.defaultArgs
  ).map((p) => [
    p.id,
    {
      ...(p.cli ? { cli: p.cli } : {}),
      ...(p.resumeFlag ? { resumeFlag: p.resumeFlag } : {}),
      ...(p.autoApproveFlag ? { autoApproveFlag: p.autoApproveFlag } : {}),
      ...(p.initialPromptFlag !== undefined ? { initialPromptFlag: p.initialPromptFlag } : {}),
      ...(p.defaultArgs ? { defaultArgs: p.defaultArgs } : {}),
      ...(p.sessionIdFlag ? { sessionIdFlag: p.sessionIdFlag } : {}),
    },
  ])
);

export const providerCustomConfigsSchema = z
  .record(z.string(), providerCustomConfigEntrySchema)
  .default(providerConfigDefaults);

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema.default('terminal'),
  hidden: z.array(openInAppIdSchema).default([]),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  providerConfigs: providerCustomConfigsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  providerConfigs: providerCustomConfigsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
});
