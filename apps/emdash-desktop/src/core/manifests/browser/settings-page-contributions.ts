import { machinesConnectionsPage } from '@core/features/machines/contributions/settings-page';
import {
  agentsSettingsPage,
  browserSettingsPage,
  generalSettingsPage,
  integrationsSettingsPage,
  interfaceSettingsPage,
  localWorkspacesSettingsPage,
  repositorySettingsPage,
} from '@core/features/settings/contributions/settings-pages';
import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import type { SettingsPageContribution } from '@core/primitives/settings/api/page-contribution';

export const settingsPageContributions = [
  generalSettingsPage,
  integrationsSettingsPage,
  interfaceSettingsPage,
  browserSettingsPage,
  repositorySettingsPage,
  agentsSettingsPage,
  localWorkspacesSettingsPage,
  machinesConnectionsPage,
] as const satisfies readonly SettingsPageContribution<Exclude<SettingsPageTab, 'docs'>>[];
