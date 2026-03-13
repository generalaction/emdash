import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { openInAppIdSchema } from '@shared/openInApps';
import { DEFAULT_PROVIDER_ID, PROVIDER_IDS, PROVIDERS } from '@shared/providers/registry';
import { db } from '@main/db/client';
import { appSettings } from '@main/db/schema';

const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string().default(join(homedir(), 'emdash', 'projects')),
  defaultWorktreeDirectory: z.string().default(join(homedir(), 'emdash', 'worktrees')),
  branchPrefix: z.string().default('emdash'),
  pushOnCreate: z.boolean().default(true),
});

export type LocalProjectSettings = z.infer<typeof localProjectSettingsSchema>;

const notificationSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  sound: z.boolean().default(true),
  osNotifications: z.boolean().default(true),
  soundFocusMode: z.enum(['always', 'unfocused']).default('always'),
});

export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;

const taskSettingsSchema = z.object({
  autoGenerateName: z.boolean().default(true),
  autoApproveByDefault: z.boolean().default(false),
  autoTrustWorktrees: z.boolean().default(true),
});

export type TaskSettings = z.infer<typeof taskSettingsSchema>;

const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean().default(false),
});

export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;

const themeSchema = z.enum(['light', 'dark', 'dark-black', 'system']).default('system');

export type Theme = z.infer<typeof themeSchema>;

const defaultAgentSchema = z.enum(PROVIDER_IDS).default(DEFAULT_PROVIDER_ID);

const keyboardSettingsSchema = z.record(z.string(), z.string()).default({
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

const providerCustomConfigEntrySchema = z.object({
  cli: z.string().optional(),
  resumeFlag: z.string().optional(),
  defaultArgs: z.array(z.string()).optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  sessionIdFlag: z.string().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const providerConfigDefaults = Object.fromEntries(
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

const providerCustomConfigsSchema = z
  .record(z.string(), providerCustomConfigEntrySchema)
  .default(providerConfigDefaults);

const openInSettingsSchema = z.object({
  default: openInAppIdSchema.default('terminal'),
  hidden: z.array(openInAppIdSchema).default([]),
});

const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  providerConfigs: providerCustomConfigsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
} as const;

const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  tasks: taskSettingsSchema,
  defaultAgent: defaultAgentSchema,
  keyboard: keyboardSettingsSchema,
  providerConfigs: providerCustomConfigsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
});

export type AppSettings = z.infer<typeof appSettingsSchema>;

export type AppSettingsKey = keyof AppSettings;

class AppSettingsService {
  private cache: AppSettings | undefined;

  async initialize(): Promise<void> {
    await this.getAllSettings();
  }

  async getAllSettings(): Promise<AppSettings> {
    if (this.cache) return this.cache;
    const persistedSettings = await db.select().from(appSettings).execute();
    const keyedSettings = Object.fromEntries(
      persistedSettings.map((s) => [s.key, JSON.parse(s.value)])
    );

    const missingSettings = Object.keys(appSettingsSchema.shape).filter(
      (key) => !keyedSettings[key]
    );

    const settings = {
      ...persistedSettings.reduce(
        (acc, curr) => {
          acc[curr.key] = JSON.parse(curr.value);
          return acc;
        },
        {} as Record<string, unknown>
      ),
      ...Object.fromEntries(
        missingSettings.map((key) => [
          key,
          APP_SETTINGS_SCHEMA_MAP[key as keyof AppSettings].parse(undefined),
        ])
      ),
    };
    const parsedSettings = appSettingsSchema.parse(settings);
    this.cache = parsedSettings;
    return parsedSettings;
  }

  async updateSettingsKey<T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> {
    await db
      .update(appSettings)
      .set({
        value: JSON.stringify(APP_SETTINGS_SCHEMA_MAP[key].parse(value)),
      })
      .where(eq(appSettings.key, key))
      .execute();
    if (this.cache) {
      this.cache[key] = value;
    }
  }

  async getAppSettingsKey<T extends AppSettingsKey>(key: T): Promise<AppSettings[T]> {
    const settings = await this.getAllSettings();
    return settings[key] as AppSettings[T];
  }
}

export const appSettingsService = new AppSettingsService();
