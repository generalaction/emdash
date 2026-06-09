import { ExternalLink, Search, X } from 'lucide-react';
import React, { useCallback, useState } from 'react';
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

interface SectionConfig {
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
  searchText: string;
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();

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

  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const tabs: Array<{
    id: SettingsPageTab;
    label: string;
    isExternal?: boolean;
  }> = [
    { id: 'general', label: 'General' },
    { id: 'account', label: 'Account' },
    { id: 'clis-models', label: 'Agents' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'connections', label: 'Connections' },
    { id: 'repository', label: 'Repository' },
    { id: 'interface', label: 'Interface' },
    { id: 'docs', label: 'Docs', isExternal: true },
  ];

  const tabContent: Partial<
    Record<SettingsPageTab, { title: string; description: string; sections: SectionConfig[] }>
  > = {
    general: {
      title: 'General',
      description: 'Manage your account, privacy settings, notifications, and app updates.',
      sections: [
        {
          component: <TelemetryCard />,
          searchText: 'telemetry analytics privacy tracking product usage',
        },
        {
          component: <AutoGenerateTaskNamesRow />,
          searchText: 'auto generate task names tasks naming ai summary',
        },
        {
          component: <AutoTrustWorktreesRow />,
          searchText: 'auto trust worktrees permissions security approvals sandbox',
        },
        {
          component: <CreateBranchAndWorktreeRow />,
          searchText: 'create branch worktree tasks git checkout',
        },
        {
          component: <PreserveTaskNameCapitalizationRow />,
          searchText: 'preserve task name capitalization case title names',
        },
        {
          component: <IncludeIssueContextByDefaultRow />,
          searchText: 'include issue context default linear github jira tickets tasks',
        },
        {
          component: <EnableTmuxRow />,
          searchText: 'tmux terminal sessions panes multiplexing',
        },
        {
          component: <NotificationSettingsCard />,
          searchText: 'notifications alerts sounds desktop updates task completion',
        },
        {
          component: <UpdateCard />,
          searchText: 'updates version app update release download',
        },
      ],
    },
    account: {
      title: 'Account',
      description: 'Manage your Emdash account.',
      sections: [{ component: <AccountTab />, searchText: 'account sign in login user profile' }],
    },
    'clis-models': {
      title: 'Agents',
      description: 'Manage CLI agents and model configurations.',
      sections: [
        {
          component: <DefaultAgentSettingsCard />,
          searchText: `default agent cli model provider claude code cloud code amp ${agentProviderSearchText}`,
        },
        {
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
          component: <ThemeCard />,
          searchText: 'theme appearance light dark system color emdash light emdash dark',
        },
        {
          component: <TerminalSettingsCard />,
          searchText: 'terminal font size family shell copy selection option meta cursor',
        },
        {
          component: <SidebarMetadataSettingsCard />,
          searchText: 'sidebar metadata task list badges details density',
        },
        {
          component: <ResourceMonitorSettingsCard />,
          searchText: 'resource monitor cpu memory usage performance status',
        },
        {
          component: <InterfaceSettingsCard />,
          searchText: 'interface appearance behavior layout animations density',
        },
        {
          title: 'Keyboard shortcuts',
          component: <KeyboardSettingsCard />,
          searchText: 'keyboard shortcuts hotkeys keybindings commands',
        },
        {
          title: 'Tools',
          component: <HiddenToolsSettingsCard />,
          searchText: 'tools hidden disabled agent tools permissions',
        },
      ],
    },
  };

  const tabMatchesSearch = (tab: (typeof tabs)[number]) => {
    if (!normalizedSearchQuery) return true;
    const content = tabContent[tab.id];
    const searchableText = [
      tab.label,
      content?.title,
      content?.description,
      ...(content?.sections.flatMap((section) => [section.title, section.searchText]) ?? []),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchableText.includes(normalizedSearchQuery);
  };

  const isSearching = normalizedSearchQuery.length > 0;
  const currentTab = tabs.find((tab) => tab.id === activeTab);
  const visibleTabs = tabs.filter(
    (tab) => !isSearching || (!tab.isExternal && tabMatchesSearch(tab))
  );
  const hasSearchResults = visibleTabs.length > 0;
  const displayedTab =
    isSearching &&
    hasSearchResults &&
    (!currentTab || currentTab.isExternal || !tabMatchesSearch(currentTab))
      ? visibleTabs[0]
      : currentTab;
  const displayedContent =
    isSearching && !hasSearchResults
      ? undefined
      : displayedTab
        ? tabContent[displayedTab.id]
        : undefined;
  const visibleSections =
    isSearching && hasSearchResults
      ? (displayedContent?.sections.filter((section) =>
          [displayedContent.title, displayedContent.description, section.title, section.searchText]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(normalizedSearchQuery)
        ) ?? [])
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
                {!hasSearchResults && (
                  <div className="px-3 py-2 text-sm text-foreground-muted">No settings found</div>
                )}
              </nav>
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
                {visibleSections.map((section, index) => (
                  <div
                    key={section.title ?? section.searchText ?? index}
                    className="flex flex-col gap-3"
                  >
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
