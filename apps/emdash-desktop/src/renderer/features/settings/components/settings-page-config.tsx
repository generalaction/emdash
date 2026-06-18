import { AGENT_PROVIDERS } from '@shared/core/agents/agent-provider-registry';

export type SettingsPageTab =
  | 'general'
  | 'account'
  | 'clis-models'
  | 'integrations'
  | 'connections'
  | 'browser'
  | 'repository'
  | 'interface'
  | 'docs';

export type SettingsContentTab = Exclude<SettingsPageTab, 'docs'>;

export interface SectionSearchConfig {
  id: string;
  title?: string;
  searchText: string;
}

export interface TabSearchConfig {
  title: string;
  description: string;
  sections: SectionSearchConfig[];
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
  { id: 'browser', label: 'Browser' },
  { id: 'docs', label: 'Docs', isExternal: true },
];

export const settingsSearchContent: Record<SettingsContentTab, TabSearchConfig> = {
  general: {
    title: 'General',
    description: 'Manage your account, privacy settings, notifications, and app updates.',
    sections: [
      {
        id: 'telemetry',
        searchText: 'telemetry analytics privacy tracking product usage',
      },
      {
        id: 'auto-generate-task-names',
        searchText: 'auto generate task names tasks naming ai summary',
      },
      {
        id: 'auto-trust-worktrees',
        searchText: 'auto trust worktrees permissions security approvals sandbox',
      },
      {
        id: 'create-branch-and-worktree',
        searchText: 'create branch worktree tasks git checkout',
      },
      {
        id: 'preserve-task-name-capitalization',
        searchText: 'preserve task name capitalization case title names',
      },
      {
        id: 'include-issue-context-by-default',
        searchText: 'include issue context default linear github jira tickets tasks',
      },
      {
        id: 'enable-tmux',
        searchText: 'tmux terminal sessions panes multiplexing',
      },
      {
        id: 'notifications',
        searchText:
          'notifications alerts sound sounds custom sound custom sounds audio file cue desktop updates task completion',
      },
      {
        id: 'updates',
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
        searchText: `default agent cli model provider claude code cloud code amp ${agentProviderSearchText}`,
      },
      {
        id: 'cli-agents',
        title: 'CLI agents',
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
        searchText: 'ssh connections remote hosts keys servers reusable projects',
      },
    ],
  },
  browser: {
    title: 'Browser',
    description: 'Manage browser profiles and their stored logins.',
    sections: [
      {
        id: 'browser-profiles',
        searchText: 'browser profiles logins authentication cookies sessions stored login',
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
        searchText: 'theme appearance light dark system color emdash light emdash dark',
      },
      {
        id: 'terminal',
        searchText: 'terminal font size family shell copy selection option meta cursor',
      },
      {
        id: 'sidebar-metadata',
        searchText: 'sidebar metadata task list badges details density',
      },
      {
        id: 'resource-monitor',
        searchText: 'resource monitor cpu memory usage performance status',
      },
      {
        id: 'interface',
        searchText: 'interface appearance behavior layout animations density',
      },
      {
        id: 'keyboard-shortcuts',
        title: 'Keyboard shortcuts',
        searchText: 'keyboard shortcuts hotkeys keybindings commands',
      },
      {
        id: 'tools',
        title: 'Tools',
        searchText: 'tools hidden disabled agent tools permissions',
      },
    ],
  },
};
