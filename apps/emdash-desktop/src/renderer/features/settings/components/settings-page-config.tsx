import React from 'react';
import { AGENT_PROVIDERS } from '@shared/core/agents/agent-provider-registry';
import { AccountTab } from './AccountTab';
import { CliAgentsList } from './CliAgentsList';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import InterfaceSettingsCard from './InterfaceSettingsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ResourceMonitorSettingsCard from './ResourceMonitorSettingsCard';
import SidebarMetadataSettingsCard from './SidebarMetadataSettingsCard';
import { SshConnectionsSettingsCard } from './SshConnectionsSettingsCard';
import {
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CreateBranchAndWorktreeRow,
  EnableTmuxRow,
  IncludeIssueContextByDefaultRow,
  PreserveTaskNameCapitalizationRow,
} from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import ThemeCard from './ThemeCard';
import { UpdateCard } from './UpdateCard';

export type SettingsPageTab =
  | 'general'
  | 'account'
  | 'clis-models'
  | 'integrations'
  | 'connections'
  | 'repository'
  | 'interface'
  | 'docs';

export type SettingsContentTab = Exclude<SettingsPageTab, 'docs'>;

export interface SectionConfig {
  id: string;
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
  searchText: string;
}

export interface TabContent {
  title: string;
  description: string;
  sections: SectionConfig[];
}

export type SettingsNavTab =
  | {
      id: SettingsContentTab;
      label: string;
      isExternal?: false;
    }
  | {
      id: 'docs';
      label: string;
      isExternal: true;
    };

const agentProviderSearchText = AGENT_PROVIDERS.flatMap((provider) => [
  provider.id,
  provider.name,
  provider.alt,
  provider.cli,
  provider.description,
  ...(provider.commands ?? []),
])
  .filter(Boolean)
  .join(' ');

export const settingsTabs: SettingsNavTab[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'clis-models', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'connections', label: 'Connections' },
  { id: 'repository', label: 'Repository' },
  { id: 'interface', label: 'Interface' },
  { id: 'docs', label: 'Docs', isExternal: true },
];

export const settingsTabContent: Record<SettingsContentTab, TabContent> = {
  general: {
    title: 'General',
    description: 'Manage your account, privacy settings, notifications, and app updates.',
    sections: [
      {
        id: 'telemetry',
        component: <TelemetryCard />,
        searchText: 'telemetry analytics privacy tracking product usage',
      },
      {
        id: 'auto-generate-task-names',
        component: <AutoGenerateTaskNamesRow />,
        searchText: 'auto generate task names tasks naming ai summary',
      },
      {
        id: 'auto-trust-worktrees',
        component: <AutoTrustWorktreesRow />,
        searchText: 'auto trust worktrees permissions security approvals sandbox',
      },
      {
        id: 'create-branch-and-worktree',
        component: <CreateBranchAndWorktreeRow />,
        searchText: 'create branch worktree tasks git checkout',
      },
      {
        id: 'preserve-task-name-capitalization',
        component: <PreserveTaskNameCapitalizationRow />,
        searchText: 'preserve task name capitalization case title names',
      },
      {
        id: 'include-issue-context-by-default',
        component: <IncludeIssueContextByDefaultRow />,
        searchText: 'include issue context default linear github jira tickets tasks',
      },
      {
        id: 'enable-tmux',
        component: <EnableTmuxRow />,
        searchText: 'tmux terminal sessions panes multiplexing',
      },
      {
        id: 'notifications',
        component: <NotificationSettingsCard />,
        searchText:
          'notifications alerts sound sounds custom sound custom sounds audio file cue desktop updates task completion',
      },
      {
        id: 'updates',
        component: <UpdateCard />,
        searchText: 'updates version app update release download',
      },
    ],
  },
  account: {
    title: 'Account',
    description: 'Manage your Emdash account.',
    sections: [
      {
        id: 'account',
        component: <AccountTab />,
        searchText: 'account sign in login user profile',
      },
    ],
  },
  'clis-models': {
    title: 'Agents',
    description: 'Manage CLI agents and model configurations.',
    sections: [
      {
        id: 'default-agent',
        component: <DefaultAgentSettingsCard />,
        searchText: `default agent cli model provider claude code cloud code amp ${agentProviderSearchText}`,
      },
      {
        id: 'cli-agents',
        title: 'CLI agents',
        component: (
          <div className="bg-muted/10 rounded-xl border border-border/60 p-2">
            <CliAgentsList />
          </div>
        ),
        searchText: `cli agents models providers codex claude code cloud code gemini opencode amp install detected missing command ${agentProviderSearchText}`,
      },
    ],
  },
  integrations: {
    title: 'Integrations',
    description: 'Connect external services and tools.',
    sections: [
      {
        id: 'integrations',
        component: <IntegrationsCard />,
        searchText: 'integrations github gitlab linear jira connect services accounts tokens',
      },
    ],
  },
  connections: {
    title: 'Connections',
    description: 'Manage reusable SSH connections for remote projects.',
    sections: [
      {
        id: 'ssh-connections',
        component: <SshConnectionsSettingsCard />,
        searchText: 'ssh connections remote hosts keys servers reusable projects',
      },
    ],
  },
  repository: {
    title: 'Repository',
    description: 'Configure repository and branch settings.',
    sections: [
      {
        id: 'branch-prefix',
        title: 'Branch prefix',
        component: <RepositorySettingsCard />,
        searchText: 'branch prefix repository git default branch remote worktree',
      },
    ],
  },
  interface: {
    title: 'Interface',
    description: 'Customize the appearance and behavior of the app.',
    sections: [
      {
        id: 'theme',
        component: <ThemeCard />,
        searchText: 'theme appearance light dark system color emdash light emdash dark',
      },
      {
        id: 'terminal',
        component: <TerminalSettingsCard />,
        searchText: 'terminal font size family shell copy selection option meta cursor',
      },
      {
        id: 'sidebar-metadata',
        component: <SidebarMetadataSettingsCard />,
        searchText: 'sidebar metadata task list badges details density',
      },
      {
        id: 'resource-monitor',
        component: <ResourceMonitorSettingsCard />,
        searchText: 'resource monitor cpu memory usage performance status',
      },
      {
        id: 'interface',
        component: <InterfaceSettingsCard />,
        searchText: 'interface appearance behavior layout animations density',
      },
      {
        id: 'keyboard-shortcuts',
        title: 'Keyboard shortcuts',
        component: <KeyboardSettingsCard />,
        searchText: 'keyboard shortcuts hotkeys keybindings commands',
      },
      {
        id: 'tools',
        title: 'Tools',
        component: <HiddenToolsSettingsCard />,
        searchText: 'tools hidden disabled agent tools permissions',
      },
    ],
  },
};
