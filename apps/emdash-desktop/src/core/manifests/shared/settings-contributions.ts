import { defaultAgentSettingsContribution } from '@core/features/agents/contributions/settings';
import {
  browserPreviewSettingsContribution,
  browserSettingsContribution,
} from '@core/features/browser/contributions/settings';
import {
  localProjectSettingsContribution,
  projectSettingsContribution,
} from '@core/features/projects/contributions/settings';
import { changesViewModeSettingsContribution } from '@core/features/source-control/contributions/settings';
import { taskSettingsContribution } from '@core/features/tasks/contributions/settings';
import { terminalSettingsContribution } from '@core/features/terminals/contributions/settings';
import {
  interfaceSettingsContribution,
  keyboardSettingsContribution,
  openInSettingsContribution,
  themeSettingsContribution,
} from '@core/features/workbench/contributions/settings';
import type { SettingsValues } from '@core/primitives/settings/api';
import { notificationSettingsContribution } from '@core/services/notifications/contributions/settings';

export const appSettingsContributions = {
  localProject: localProjectSettingsContribution,
  project: projectSettingsContribution,
  tasks: taskSettingsContribution,
  defaultAgent: defaultAgentSettingsContribution,
  keyboard: keyboardSettingsContribution,
  notifications: notificationSettingsContribution,
  theme: themeSettingsContribution,
  openIn: openInSettingsContribution,
  interface: interfaceSettingsContribution,
  terminal: terminalSettingsContribution,
  browserPreview: browserPreviewSettingsContribution,
  browser: browserSettingsContribution,
  changesViewMode: changesViewModeSettingsContribution,
} as const;

export type AppSettings = SettingsValues<typeof appSettingsContributions>;
export type AppSettingsKey = keyof AppSettings;

export const AppSettingsKeys = Object.keys(appSettingsContributions) as AppSettingsKey[];

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const defaults = appSettingsContributions[key].defaults;
  return (typeof defaults === 'function' ? defaults() : defaults) as AppSettings[K];
}
