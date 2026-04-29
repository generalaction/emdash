import z from 'zod';
import { AGENT_PROVIDER_IDS, AGENT_PROVIDERS } from '@shared/agent-provider-registry';
import { openInAppIdSchema } from '@shared/openInApps';
import { DEFAULT_AGENT_ID, DEFAULT_REVIEW_PROMPT } from './settings-registry';

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  branchPrefix: z.string(),
  pushOnCreate: z.boolean(),
  writeAgentConfigToGitIgnore: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  autoTrustWorktrees: z.boolean(),
  autoRenameFromFirstPrompt: z.boolean(),
});

export const agentAutoApproveDefaultsSchema = z
  .partialRecord(z.enum(AGENT_PROVIDER_IDS), z.boolean())
  .default({});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean(),
});

export const themeSchema = z
  .enum(['emlight', 'emdark'])
  .nullable()
  .catch(null)
  .optional()
  .default(null);

export const defaultAgentSchema = z.optional(z.enum(AGENT_PROVIDER_IDS)).default(DEFAULT_AGENT_ID);

export const reviewPromptSchema = z.string().default(DEFAULT_REVIEW_PROMPT);

export const keyboardSettingsSchema = z
  .optional(
    z.object({
      commandPalette: z.string().nullable().optional(),
      settings: z.string().nullable().optional(),
      toggleLeftSidebar: z.string().nullable().optional(),
      toggleRightSidebar: z.string().nullable().optional(),
      toggleTheme: z.string().nullable().optional(),
      closeModal: z.string().nullable().optional(),
      nextProject: z.string().nullable().optional(),
      prevProject: z.string().nullable().optional(),
      newTask: z.string().nullable().optional(),
      newProject: z.string().nullable().optional(),
      openInEditor: z.string().nullable().optional(),
      taskViewAgents: z.string().nullable().optional(),
      taskViewDiff: z.string().nullable().optional(),
      taskViewEditor: z.string().nullable().optional(),
      tabNext: z.string().nullable().optional(),
      tabPrev: z.string().nullable().optional(),
      tabClose: z.string().nullable().optional(),
      newConversation: z.string().nullable().optional(),
      newTerminal: z.string().nullable().optional(),
      confirm: z.string().nullable().optional(),
    })
  )
  .default({});

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
  AGENT_PROVIDERS.filter(
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

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
});
