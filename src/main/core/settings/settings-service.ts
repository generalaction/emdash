import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import z from 'zod';
import { openInAppIdSchema } from '@shared/openInApps';
import { DEFAULT_PROVIDER_ID, PROVIDER_IDS } from '@shared/providers/registry';
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
  defaultArgs: z.string().optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

const providerCustomConfigsSchema = z
  .record(z.string(), providerCustomConfigEntrySchema)
  .default({});

const openInSettingsSchema = z.object({
  default: openInAppIdSchema.default('terminal'),
  hidden: z.array(openInAppIdSchema).default([]),
});

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
    const settings = await db.select().from(appSettings).execute();
    if (settings.length === 0) {
      return appSettingsSchema.parse(JSON.parse('{}'));
    }
    this.cache = appSettingsSchema.parse(
      settings.reduce(
        (acc, curr) => {
          acc[curr.key] = JSON.parse(curr.value);
          return acc;
        },
        {} as Record<string, unknown>
      )
    );
    return this.cache;
  }

  async updateSettingsKey<T extends AppSettingsKey>(key: T, value: AppSettings[T]): Promise<void> {
    await db
      .update(appSettings)
      .set({
        value: JSON.stringify(value),
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
