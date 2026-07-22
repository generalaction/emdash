import { defineSettingsPageContribution } from '@core/primitives/settings/api/page-contribution';
import { appState } from '@renderer/lib/stores/app-state';
import { MachineDetailsPage } from '../browser/pages/machine-details-page';
import { MachinesSettingsPage } from '../browser/pages/machines-settings-page';

export const machinesConnectionsPage = defineSettingsPageContribution({
  id: 'connections',
  label: 'Remote Machines',
  icon: 'server',
  component: MachinesSettingsPage,
  detail: {
    component: MachineDetailsPage,
    breadcrumbLabel: (detailId) =>
      appState.machines.connections.find((connection) => connection.id === detailId)?.name ?? null,
  },
});
