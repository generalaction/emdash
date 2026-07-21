import { machinesConnectionsPage } from '@core/features/machines/contributions/settings-page';
import {
  accountSettingsPage,
  agentsSettingsPage,
  browserSettingsPage,
  generalSettingsPage,
  integrationsSettingsPage,
  interfaceSettingsPage,
  repositorySettingsPage,
} from '@core/features/settings/contributions/settings-pages';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import type { SettingsPageContribution } from '@core/primitives/settings/api/page-contribution';

export const settingsPageContributions = [
  generalSettingsPage,
  accountSettingsPage,
  agentsSettingsPage,
  integrationsSettingsPage,
  machinesConnectionsPage,
  browserSettingsPage,
  repositorySettingsPage,
  interfaceSettingsPage,
] as const satisfies readonly SettingsPageContribution<Exclude<SettingsPageTab, 'docs'>>[];
