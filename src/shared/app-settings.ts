import z from 'zod';
import {
  appSettingsSchema,
  localProjectSettingsSchema,
  notificationSettingsSchema,
  taskSettingsSchema,
  terminalSettingsSchema,
  themeSchema,
} from '@main/core/settings/schema';

export type LocalProjectSettings = z.infer<typeof localProjectSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type TaskSettings = z.infer<typeof taskSettingsSchema>;
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
export type Theme = z.infer<typeof themeSchema>;
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsSchema.shape) as AppSettingsKey[];
