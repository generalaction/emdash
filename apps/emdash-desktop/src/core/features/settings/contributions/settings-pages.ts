import {
  defineSettingsPageContribution,
  type SettingsPageContribution,
} from '@core/primitives/settings/api/page-contribution';
import { AgentsSettingsPage } from '../browser/agents-page/AgentsSettingsPage';
import { BrowserSettingsPage } from '../browser/pages/browser-settings-page';
import { GeneralSettingsPage } from '../browser/pages/general-settings-page';
import { IntegrationsSettingsPage } from '../browser/pages/integrations-settings-page';
import { InterfaceSettingsPage } from '../browser/pages/interface-settings-page';
import { LocalWorkspacesSettingsPage } from '../browser/pages/local-workspaces-settings-page';
import { RepositorySettingsPage } from '../browser/pages/repository-settings-page';
import type { SettingsPageTab } from './views';

export const generalSettingsPage = defineSettingsPageContribution({
  id: 'general',
  label: 'General',
  icon: 'settings',
  component: GeneralSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const integrationsSettingsPage = defineSettingsPageContribution({
  id: 'integrations',
  label: 'Integrations',
  icon: 'plug',
  component: IntegrationsSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const interfaceSettingsPage = defineSettingsPageContribution({
  id: 'interface',
  label: 'Interface',
  icon: 'panel-left',
  component: InterfaceSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const browserSettingsPage = defineSettingsPageContribution({
  id: 'browser',
  label: 'Browser',
  icon: 'globe',
  component: BrowserSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const repositorySettingsPage = defineSettingsPageContribution({
  id: 'repository',
  label: 'Repository',
  icon: 'git-branch',
  component: RepositorySettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const agentsSettingsPage = defineSettingsPageContribution({
  id: 'clis-models',
  label: 'Agents',
  icon: 'bot',
  component: AgentsSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);

export const localWorkspacesSettingsPage = defineSettingsPageContribution({
  id: 'workspaces-local',
  label: 'Workspaces (local)',
  icon: 'folder-git-2',
  component: LocalWorkspacesSettingsPage,
} satisfies SettingsPageContribution<SettingsPageTab>);
