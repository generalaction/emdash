import { homedir } from 'node:os';
import { join } from 'node:path';
import z from 'zod';
import { DEFAULT_PROVIDER_ID, PROVIDER_IDS, PROVIDERS } from '@shared/agent-provider-registry';
import { openInAppIdSchema } from '@shared/openInApps';

export const localProjectSettingsSchema = z
  .object({
    defaultProjectsDirectory: z.string(),
    defaultWorktreeDirectory: z.string(),
    branchPrefix: z.string(),
    pushOnCreate: z.boolean(),
  })
  .default({
    defaultProjectsDirectory: join(homedir(), 'emdash', 'projects'),
    defaultWorktreeDirectory: join(homedir(), 'emdash', 'worktrees'),
    branchPrefix: 'emdash',
    pushOnCreate: true,
  });

export const notificationSettingsSchema = z
  .object({
    enabled: z.boolean(),
    sound: z.boolean(),
    osNotifications: z.boolean(),
    soundFocusMode: z.enum(['always', 'unfocused']),
  })
  .default({
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always',
  });

export const taskSettingsSchema = z
  .object({
    autoGenerateName: z.boolean(),
    autoApproveByDefault: z.boolean(),
    autoTrustWorktrees: z.boolean(),
  })
  .default({
    autoGenerateName: true,
    autoApproveByDefault: false,
    autoTrustWorktrees: true,
  });

export const terminalSettingsSchema = z
  .object({
    fontFamily: z.string().optional(),
    autoCopyOnSelection: z.boolean(),
  })
  .default({ autoCopyOnSelection: false });

export const themeSchema = z
  .optional(z.enum(['light', 'dark', 'dark-black', 'system']))
  .default('system');

export const defaultAgentSchema = z.optional(z.enum(PROVIDER_IDS)).default(DEFAULT_PROVIDER_ID);

// Each field is optional — defaults live in the renderer's APP_SHORTCUTS registry,
// not here, because some defaults are platform-specific (resolved at runtime).
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
  .default({
    commandPalette: 'Mod+K',
    settings: 'Mod+,',
    toggleLeftSidebar: 'Mod+B',
    toggleRightSidebar: 'Mod+.',
    toggleTheme: 'Mod+T',
    toggleKanban: 'Mod+P',
    toggleEditor: 'Mod+E',
    closeModal: 'Escape',
    nextProject: 'Mod+]',
    prevProject: 'Mod+[',
    newTask: 'Mod+N',
    nextAgent: 'Mod+Shift+K',
    prevAgent: 'Mod+Shift+J',
    openInEditor: 'Mod+E',
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

// Runtime/consumer type — registry defaults are merged in at read time.
export const providerCustomConfigsSchema = z
  .record(z.string(), providerCustomConfigEntrySchema)
  .default(providerConfigDefaults);

// Persistence type — only user-modified fields are stored; no registry defaults baked in.
export const providerConfigOverridesSchema = z
  .record(z.string(), providerCustomConfigEntrySchema)
  .default({});

export const mcpSettingsSchema = z
  .object({
    context7: z
      .object({
        enabled: z.boolean(),
        installHintsDismissed: z.record(z.string(), z.boolean()).optional(),
      })
      .default({ enabled: false }),
  })
  .default({ context7: { enabled: false } });

export const interfaceSettingsSchema = z
  .object({
    taskHoverAction: z.enum(['delete', 'archive']),
    autoRightSidebarBehavior: z.boolean(),
  })
  .default({ taskHoverAction: 'delete', autoRightSidebarBehavior: false });

export const browserPreviewSettingsSchema = z
  .object({ enabled: z.boolean() })
  .default({ enabled: true });

export const openInSettingsSchema = z
  .object({
    default: openInAppIdSchema,
    hidden: z.array(openInAppIdSchema),
  })
  .default({ default: 'terminal', hidden: [] });

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  providerConfigs: providerConfigOverridesSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  mcp: mcpSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
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
  mcp: mcpSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
});
