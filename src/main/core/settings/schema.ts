import z from 'zod';
import { DEFAULT_PROVIDER_ID, PROVIDER_IDS, PROVIDERS } from '@shared/agent-provider-registry';
import { openInAppIdSchema } from '@shared/openInApps';

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  branchPrefix: z.string(),
  pushOnCreate: z.boolean(),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean(),
  autoApproveByDefault: z.boolean(),
  autoTrustWorktrees: z.boolean(),
});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean(),
});

// z.optional().default() keeps the TypeScript type non-optional while still allowing
// undefined as a stored value.
export const themeSchema = z
  .optional(z.enum(['light', 'dark', 'dark-black', 'system']))
  .default('system');

export const defaultAgentSchema = z.optional(z.enum(PROVIDER_IDS)).default(DEFAULT_PROVIDER_ID);

// Each field is optional — defaults live in settings-registry.ts.
export const keyboardSettingsSchema = z
  .optional(
    z.object({
      commandPalette: z.string().optional(),
      settings: z.string().optional(),
      toggleLeftSidebar: z.string().optional(),
      toggleRightSidebar: z.string().optional(),
      toggleTheme: z.string().optional(),
      toggleKanban: z.string().optional(),
      toggleEditor: z.string().optional(),
      closeModal: z.string().optional(),
      nextProject: z.string().optional(),
      prevProject: z.string().optional(),
      newTask: z.string().optional(),
      nextAgent: z.string().optional(),
      prevAgent: z.string().optional(),
      openInEditor: z.string().optional(),
    })
  )
  .default({});

// providerConfigs schema — used by OverrideSettings for per-item validation.
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

// External defaults for providerConfigs, sourced from the provider registry.
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
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
} as const;

// providerConfigs is intentionally excluded — it is managed by OverrideSettings.
export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
});
