import type { SettingsPageTab } from '@core/features/settings/contributions/views';
import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { appState } from '@renderer/lib/stores/app-state';
import { LocalWorkspaceDetailPage } from '../browser/pages/local-workspace-detail-page';
import { LocalWorkspacesSettingsPage } from '../browser/pages/local-workspaces-settings-page';
import { MachineDetailsPage } from '../browser/pages/machine-details-page';
import { MachinesSettingsPage } from '../browser/pages/machines-settings-page';
import { SystemSettingsPage } from '../browser/pages/system-settings-page';

export const systemSettingsPage = defineSettingsPageContribution({
  id: 'system',
  label: 'System',
  icon: 'activity',
  component: SystemSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const localWorkspacesSettingsPage = defineSettingsPageContribution({
  id: 'workspaces-local',
  label: 'Workspaces',
  icon: 'folder-git-2',
  component: LocalWorkspacesSettingsPage,
  detail: {
    component: LocalWorkspaceDetailPage,
    breadcrumbLabel: (detailId) => appState.projects.projects.get(detailId)?.data?.name ?? null,
  },
} satisfies SettingsPageContribution<SettingsPageTab>);

export const machinesConnectionsPage = defineSettingsPageContribution({
  id: 'connections',
  label: 'Machines',
  icon: 'server',
  component: MachinesSettingsPage,
  detail: {
    component: MachineDetailsPage,
    breadcrumbLabel: (detailId) =>
      appState.machines.connections.find((connection) => connection.id === detailId)?.name ?? null,
  },
} satisfies SettingsPageContribution<SettingsPageTab>);
