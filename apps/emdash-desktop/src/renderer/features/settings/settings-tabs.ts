export const SETTINGS_TABS = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'clis-models', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'connections', label: 'Connections' },
  { id: 'repository', label: 'Repository' },
  { id: 'storage', label: 'Storage' },
  { id: 'interface', label: 'Interface' },
  { id: 'browser', label: 'Browser' },
] as const;

export type SettingsPageTab = (typeof SETTINGS_TABS)[number]['id'] | 'docs';
