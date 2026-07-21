import { defineSettingsPageContribution } from '@core/primitives/settings/api/page-contribution';
import { MachinesSettingsPage } from '../browser/pages/machines-settings-page';

export const machinesConnectionsPage = defineSettingsPageContribution({
  id: 'connections',
  label: 'Machines',
  icon: 'server',
  component: MachinesSettingsPage,
});
