import type z from 'zod';
import {
  appSettingsSchema,
  type agentAutoApproveDefaultsSchema,
  type agentModelSelectionSchema,
  type agentModelsSchema,
  type changesViewModeSchema,
  type interfaceSettingsSchema,
  type localProjectSettingsSchema,
  type notificationSettingsSchema,
  type projectSettingsSchema,
  type providerCustomConfigEntrySchema,
  type taskSettingsSchema,
  type terminalSettingsSchema,
  type themeSchema,
} from '@main/core/settings/schema';

export type LocalProjectSettings = z.infer<typeof localProjectSettingsSchema>;
export type ProjectSettings = z.infer<typeof projectSettingsSchema>;
export type NotificationSettings = z.infer<typeof notificationSettingsSchema>;
export type TaskSettings = z.infer<typeof taskSettingsSchema>;
export type AgentAutoApproveDefaults = z.infer<typeof agentAutoApproveDefaultsSchema>;
export type AgentModels = z.infer<typeof agentModelsSchema>;
export type AgentModelSelectionSetting = z.infer<typeof agentModelSelectionSchema>;
export type TerminalSettings = z.infer<typeof terminalSettingsSchema>;
export type Theme = z.infer<typeof themeSchema>;

export type InterfaceSettings = z.infer<typeof interfaceSettingsSchema>;
export type ProviderCustomConfig = z.infer<typeof providerCustomConfigEntrySchema>;
export type ProviderCustomConfigs = Record<string, ProviderCustomConfig>;
export type ChangesViewMode = z.infer<typeof changesViewModeSchema>;
export type ChangesSection = keyof ChangesViewMode;
export type ChangesListViewMode = ChangesViewMode[ChangesSection];
export type AppSettings = z.infer<typeof appSettingsSchema>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsSchema.shape) as AppSettingsKey[];
