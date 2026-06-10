import { metadataRegistry } from '@emdash/cli-agent-plugins/metadata';
import z from 'zod';
import { AGENT_PROVIDER_IDS } from '@shared/core/agents/agent-provider-registry';
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_SHELL_IDS,
} from '@shared/core/terminals/terminal-settings';
import { openInAppIdSchema } from '@shared/openInApps';
import { APP_SHORTCUTS } from '@shared/shortcuts';
import { normalizeBranchPrefix } from '@shared/util/branch-prefix';
import { DEFAULT_AGENT_ID } from './settings-registry';

export const projectSettingsSchema = z.object({
  pushOnCreate: z.boolean(),
  branchPrefix: z.string().transform(normalizeBranchPrefix),
  appendRandomBranchSuffix: z.boolean(),
  tmuxByDefault: z.boolean(),
});

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  writeAgentConfigToGitIgnore: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  customSoundPath: z.string(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  autoTrustWorktrees: z.boolean(),
  createBranchAndWorktree: z.boolean(),
  preserveNameCapitalization: z.boolean(),
  includeIssueContextByDefault: z.boolean(),
});

export const agentAutoApproveDefaultsSchema = z
  .partialRecord(z.enum(AGENT_PROVIDER_IDS), z.boolean())
  .default({});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX).optional(),
  autoCopyOnSelection: z.boolean(),
  macOptionIsMeta: z.boolean(),
  defaultShell: z.enum(TERMINAL_SHELL_IDS),
});

export const themeSchema = z
  .enum(['emlight', 'emdark'])
  .nullable()
  .catch(null)
  .optional()
  .default(null);

export const defaultAgentSchema = z.optional(z.enum(AGENT_PROVIDER_IDS)).default(DEFAULT_AGENT_ID);

export const keyboardSettingsSchema = z
  .optional(
    z.object(
      Object.fromEntries(
        Object.keys(APP_SHORTCUTS).map((k) => [k, z.string().nullable().optional()])
      ) as Record<keyof typeof APP_SHORTCUTS, z.ZodOptional<z.ZodNullable<z.ZodString>>>
    )
  )
  .default({});

export const providerCustomConfigEntrySchema = z.object({
  cli: z.string().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const providerConfigDefaults = Object.fromEntries(
  metadataRegistry
    .getAll()
    .filter((m) => m.capabilities.install.binaryNames.length > 0)
    .map((m) => [m.id, { cli: m.capabilities.install.binaryNames[0] }])
);

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
  showLeftSidebarLineChanges: z.boolean(),
  showLeftSidebarPrStatus: z.boolean(),
  showLeftSidebarTimestamps: z.boolean(),
  confirmTabClose: z.boolean(),
  hideContextBar: z.boolean(),
});

export const changesViewModeSchema = z.object({
  unstaged: z.enum(['flat', 'tree']),
  staged: z.enum(['flat', 'tree']),
  pr: z.enum(['flat', 'tree']),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

export const resourceMonitorSettingsSchema = z.object({ enabled: z.boolean() });

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  resourceMonitor: resourceMonitorSettingsSchema,
  changesViewMode: changesViewModeSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
  tasks: taskSettingsSchema,
  agentAutoApproveDefaults: agentAutoApproveDefaultsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  resourceMonitor: resourceMonitorSettingsSchema,
  changesViewMode: changesViewModeSchema,
});
