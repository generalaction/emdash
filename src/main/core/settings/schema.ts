import z from 'zod';
import { AGENT_PROVIDER_IDS, AGENT_PROVIDERS } from '@shared/agent-provider-registry';
import { openInAppIdSchema } from '@shared/openInApps';
import { APP_SHORTCUTS } from '@shared/shortcuts';
import { TERMINAL_FONT_SIZE_MAX, TERMINAL_FONT_SIZE_MIN } from '@shared/terminal-settings';
import { DEFAULT_AGENT_ID, DEFAULT_REVIEW_PROMPT } from './settings-registry';

export const projectSettingsSchema = z.object({
  pushOnCreate: z.boolean(),
  branchPrefix: z.string(),
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
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  autoTrustWorktrees: z.boolean(),
  createBranchAndWorktree: z.boolean(),
});

export const agentAutoApproveDefaultsSchema = z
  .partialRecord(z.enum(AGENT_PROVIDER_IDS), z.boolean())
  .default({});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  fontSize: z.number().min(TERMINAL_FONT_SIZE_MIN).max(TERMINAL_FONT_SIZE_MAX).optional(),
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
    z.object(
      Object.fromEntries(
        Object.keys(APP_SHORTCUTS).map((k) => [k, z.string().nullable().optional()])
      ) as Record<keyof typeof APP_SHORTCUTS, z.ZodOptional<z.ZodNullable<z.ZodString>>>
    )
  )
  .default({});

export const providerCustomConfigEntrySchema = z.object({
  cli: z.string().optional(),
  resumeFlag: z.string().optional(),
  defaultArgs: z.array(z.string()).optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  sessionIdFlag: z.string().optional(),
  sessionIdOnResumeOnly: z.boolean().optional(),
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
      ...(p.sessionIdOnResumeOnly ? { sessionIdOnResumeOnly: p.sessionIdOnResumeOnly } : {}),
    },
  ])
);

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

export const resourceMonitorSettingsSchema = z.object({ enabled: z.boolean() });

/**
 * MCP server settings — controls whether emdash exposes itself as an MCP
 * server (`mcpServer.enabled`) and which loopback port it binds
 * (`mcpServer.port`). See
 * `docs/superpowers/specs/2026-05-16-mcp-server-design.md` for context.
 */
export const mcpServerSettingsSchema = z.object({
  enabled: z.boolean(),
  port: z.number().int().min(1).max(65535),
});

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
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  resourceMonitor: resourceMonitorSettingsSchema,
  mcpServer: mcpServerSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  project: projectSettingsSchema,
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
  resourceMonitor: resourceMonitorSettingsSchema,
  mcpServer: mcpServerSettingsSchema,
});
