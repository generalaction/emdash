import { defineSettingsPageContribution } from '@core/primitives/settings/api/page-contribution';
import { ConnectionsSettingsPage } from '../browser/pages/connections-settings-page';

export const machinesConnectionsPage = defineSettingsPageContribution({
  id: 'connections',
  label: 'Connections',
  icon: 'server',
  component: ConnectionsSettingsPage,
});
