import { useHotkey } from '@tanstack/react-hotkeys';
import { ExternalLink, Search, X } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { Input } from '@renderer/lib/ui/input';
import { cn } from '@renderer/utils/utils';
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

type SettingsContentTab = Exclude<SettingsPageTab, 'docs'>;

interface SectionConfig {
  id: string;
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
  searchText: string;
}

interface TabContent {
  title: string;
  description: string;
  sections: SectionConfig[];
}

type SettingsNavTab =
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

const tabs: SettingsNavTab[] = [
  { id: 'general', label: 'General' },
  { id: 'account', label: 'Account' },
  { id: 'clis-models', label: 'Agents' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'connections', label: 'Connections' },
  { id: 'repository', label: 'Repository' },
  { id: 'interface', label: 'Interface' },
  { id: 'docs', label: 'Docs', isExternal: true },
];

const tabContent: Record<SettingsContentTab, TabContent> = {
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
        searchText: 'notifications alerts sounds desktop updates task completion',
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

function matchesSearch(parts: Array<string | undefined>, normalizedQuery: string) {
  return parts.filter(Boolean).join(' ').toLowerCase().includes(normalizedQuery);
}

function tabMatchesSearch(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery) return true;
  if (tab.isExternal) return false;

  const content = tabContent[tab.id];
  return matchesSearch(
    [
      tab.label,
      content.title,
      content.description,
      ...content.sections.flatMap((section) => [section.title, section.searchText]),
    ],
    normalizedQuery
  );
}

function tabHeaderMatchesSearch(tab: SettingsNavTab, normalizedQuery: string) {
  if (!normalizedQuery || tab.isExternal) return false;

  const content = tabContent[tab.id];
  return matchesSearch([tab.label, content.title, content.description], normalizedQuery);
}

function sectionMatchesSearch(section: SectionConfig, normalizedQuery: string) {
  return matchesSearch([section.title, section.searchText], normalizedQuery);
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

  useHotkey(
    'Mod+F',
    () => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    },
    { enabled: true }
  );

  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const activeContentTab: SettingsContentTab = activeTab === 'docs' ? 'general' : activeTab;
  const matchingTabs = tabs.filter((tab) => tabMatchesSearch(tab, normalizedSearchQuery));
  const matchingContentTabs = matchingTabs.filter((tab) => !tab.isExternal);
  const hasSearchResults = matchingContentTabs.length > 0;
  const showNoSearchMatches = Boolean(normalizedSearchQuery) && !hasSearchResults;
  const visibleTabs = normalizedSearchQuery ? matchingTabs : tabs;
  const activeNavTab = tabs.find((tab) => tab.id === activeContentTab);
  const displayedTab =
    normalizedSearchQuery &&
    hasSearchResults &&
    activeNavTab &&
    !tabMatchesSearch(activeNavTab, normalizedSearchQuery)
      ? matchingContentTabs[0]
      : activeNavTab;
  const displayedContent =
    displayedTab && !displayedTab.isExternal ? tabContent[displayedTab.id] : null;
  const headerMatches = displayedTab
    ? tabHeaderMatchesSearch(displayedTab, normalizedSearchQuery)
    : false;
  const matchingSections =
    displayedContent && normalizedSearchQuery
      ? displayedContent.sections.filter((section) =>
          sectionMatchesSearch(section, normalizedSearchQuery)
        )
      : [];
  const visibleSections =
    normalizedSearchQuery && hasSearchResults
      ? headerMatches
        ? (displayedContent?.sections ?? [])
        : matchingSections
      : (displayedContent?.sections ?? []);

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          <div className="py-10">
            <div className="flex min-h-0 w-52 flex-col gap-3">
              <div className="relative mx-0.5">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-foreground-passive" />
                <Input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.currentTarget.value)}
                  placeholder="Search settings"
                  aria-label="Search settings"
                  ref={searchInputRef}
                  className="h-9 pr-8 pl-8"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear settings search"
                    className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-foreground-passive transition-colors hover:bg-background-1 hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {showNoSearchMatches && (
                <div className="px-3 text-xs text-foreground-muted">No matching settings.</div>
              )}
              {!showNoSearchMatches && (
                <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
                  {visibleTabs.map((tab) => {
                    const isActive = tab.id === displayedTab?.id && !tab.isExternal;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          if (tab.isExternal) {
                            handleDocsClick();
                          } else {
                            onTabChange(tab.id);
                          }
                        }}
                        className={cn(
                          'flex w-full items-center gap-2 hover:bg-background-1 text-foreground-muted hover:text-foreground rounded-md px-3 py-2 text-sm font-normal transition-colors',
                          isActive &&
                            'bg-background-2 text-foreground hover:bg-background-2 hover:text-foreground'
                        )}
                      >
                        <span className="text-left">{tab.label}</span>
                        {tab.isExternal && <ExternalLink className="h-4 w-4" />}
                      </button>
                    );
                  })}
                </nav>
              )}
            </div>
          </div>
          {/* Content container */}
          {displayedContent && (
            <div
              className={cn(
                'min-h-0 min-w-0 flex-1 justify-center overflow-x-hidden overflow-y-auto',
                '[scrollbar-gutter:stable]'
              )}
            >
              <div className="mx-auto w-full max-w-4xl space-y-8 px-4 py-10">
                <PageHeader
                  title={displayedContent.title}
                  description={displayedContent.description}
                />
                {visibleSections.map((section) => (
                  <div key={section.id} className="flex flex-col gap-3">
                    {section.title && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-normal text-foreground">{section.title}</h3>
                        {section.action && <div>{section.action}</div>}
                      </div>
                    )}
                    {section.component}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
