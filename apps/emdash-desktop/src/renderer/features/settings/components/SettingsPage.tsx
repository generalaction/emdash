import { ArrowRight, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { PageContent, PageLayout, PageSidebarMenu } from '@renderer/lib/components/page-layout';
import { rpc } from '@renderer/lib/ipc';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { cn } from '@renderer/utils/utils';
import { AgentsSettingsPage } from '../agents-page/AgentsSettingsPage';
import { scrollSettingTargetIntoView } from '../settings-scroll-target';
import {
  groupSettingsSearchResults,
  searchSettings,
  type SettingsSearchResult,
} from '../settings-search-index';
import { AccountTab } from './AccountTab';
import { BrowserSettingsCard } from './BrowserSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import InterfaceSettingsCard from './InterfaceSettingsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ResourceMonitorSettingsCard from './ResourceMonitorSettingsCard';
import { SettingsHighlightProvider, SettingTarget } from './SettingRow';
import SidebarMetadataSettingsCard from './SidebarMetadataSettingsCard';
import { SshConnectionsSettingsCard } from './SshConnectionsSettingsCard';
import { StorageSettingsPage } from './StorageSettingsPage';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
  CreateBranchAndWorktreeRow,
  DeleteBranchByDefaultRow,
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
  | 'browser'
  | 'repository'
  | 'storage'
  | 'interface'
  | 'docs';

export type SettingsPageTargetParams = {
  target?: string;
  highlightNonce?: number;
};

const TAB_LABELS: Record<SettingsPageTab, string> = {
  general: 'General',
  account: 'Account',
  'clis-models': 'Agents',
  integrations: 'Integrations',
  connections: 'Connections',
  browser: 'Browser',
  repository: 'Repository',
  storage: 'Storage',
  interface: 'Interface',
  docs: 'Docs',
};

function getCurrentPlatform(): 'darwin' | 'linux' | 'win32' | undefined {
  const platform = navigator.userAgent.toLowerCase();
  if (platform.includes('mac')) return 'darwin';
  if (platform.includes('win')) return 'win32';
  if (platform.includes('linux')) return 'linux';
  return undefined;
}

function SettingsSearchResults({
  query,
  results,
  onSelect,
}: {
  query: string;
  results: readonly SettingsSearchResult[];
  onSelect: (result: SettingsSearchResult) => void;
}) {
  const groups = groupSettingsSearchResults(results);

  return (
    <div className="space-y-5 py-10">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-foreground">Settings Search Results</h2>
        <p className="text-xs text-foreground-passive">
          {results.length === 0 ? 'No matching settings found.' : `${results.length} results`}
        </p>
      </div>
      {groups.length === 0 ? (
        <div className="rounded-lg border border-border/60 bg-background-secondary-1 px-4 py-8 text-center text-sm text-foreground-passive">
          No results for &ldquo;{query}&rdquo;
        </div>
      ) : (
        <div className="space-y-5">
          {groups.map((group) => (
            <section key={`${group.tab}:${group.section}`} className="space-y-2">
              <h3 className="text-sm font-medium text-foreground">
                {group.section === TAB_LABELS[group.tab]
                  ? group.section
                  : `${TAB_LABELS[group.tab]} / ${group.section}`}
              </h3>
              <div className="space-y-2">
                {group.results.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    className={cn(
                      'group flex w-full items-center gap-3 rounded-lg border border-transparent',
                      'bg-background-secondary-1 px-4 py-3 text-left transition-colors',
                      'hover:border-border hover:bg-background-2 focus-visible:border-ring',
                      'focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none'
                    )}
                    onClick={() => onSelect(result)}
                  >
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="text-sm font-medium text-foreground">{result.title}</div>
                      {result.description && (
                        <div className="text-xs text-foreground-passive">{result.description}</div>
                      )}
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-foreground-muted transition-transform group-hover:translate-x-0.5" />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab page components
// ---------------------------------------------------------------------------

function GeneralSettingsPage() {
  return (
    <div className="space-y-8 pb-10">
      <PageHeader
        sticky
        title="General"
        description="Manage your account, privacy settings, notifications, and app updates."
      />
      <UpdateCard />
      <TelemetryCard />
      <AutoGenerateTaskNamesRow />
      <AutoApproveByDefaultRow />
      <AutoTrustWorktreesRow />
      <CreateBranchAndWorktreeRow />
      <DeleteBranchByDefaultRow />
      <PreserveTaskNameCapitalizationRow />
      <IncludeIssueContextByDefaultRow />
      <EnableTmuxRow />
      <NotificationSettingsCard />
    </div>
  );
}

function AccountSettingsPage() {
  return (
    <SettingTarget settingId="account" className="space-y-8">
      <PageHeader sticky title="Account" description="Manage your Emdash account." />
      <AccountTab />
    </SettingTarget>
  );
}

function IntegrationsSettingsPage() {
  return (
    <SettingTarget settingId="integrations" className="space-y-8">
      <PageHeader sticky title="Integrations" description="Connect external services and tools." />
      <IntegrationsCard />
    </SettingTarget>
  );
}

function ConnectionsSettingsPage() {
  return (
    <SettingTarget settingId="ssh-connections" className="space-y-8">
      <PageHeader
        sticky
        title="Connections"
        description="Manage reusable SSH connections for remote projects."
      />
      <SshConnectionsSettingsCard />
    </SettingTarget>
  );
}

function RepositorySettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        sticky
        title="Repository"
        description="Configure repository and branch settings."
      />
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Branch prefix</h3>
        <RepositorySettingsCard />
      </div>
    </div>
  );
}

function InterfaceSettingsPage() {
  return (
    <div className="space-y-8 pb-4">
      <PageHeader
        sticky
        title="Interface"
        description="Customize the appearance and behavior of the app."
      />
      <ThemeCard />
      <TerminalSettingsCard />
      <SidebarMetadataSettingsCard />
      <ResourceMonitorSettingsCard />
      <InterfaceSettingsCard />
      <SettingTarget settingId="keyboard-shortcuts" className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Keyboard shortcuts</h3>
        <KeyboardSettingsCard />
      </SettingTarget>
      <SettingTarget settingId="tools-visibility" className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Tools</h3>
        <HiddenToolsSettingsCard />
      </SettingTarget>
    </div>
  );
}

function StorageTabPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        sticky
        title="Storage"
        description="Review task worktree usage and remove stale task worktrees."
      />
      <StorageSettingsPage />
    </div>
  );
}

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage({
  tab: activeTab,
  onTabChange,
  target,
  highlightNonce,
  onTargetSelect,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
  target?: string;
  highlightNonce?: number;
  onTargetSelect?: (result: SettingsSearchResult) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedSettingId, setHighlightedSettingId] = useState<string | null>(null);
  const platform = useMemo(() => getCurrentPlatform(), []);
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
    { id: 'storage', label: 'Storage' },
    { id: 'interface', label: 'Interface' },
    { id: 'browser', label: 'Browser' },
    { id: 'docs', label: 'Docs', isExternal: true },
  ];

  const tabContent: Record<string, React.ReactNode> = {
    general: <GeneralSettingsPage />,
    account: <AccountSettingsPage />,
    'clis-models': (
      <SettingTarget settingId="agents">
        <AgentsSettingsPage />
      </SettingTarget>
    ),
    integrations: <IntegrationsSettingsPage />,
    connections: <ConnectionsSettingsPage />,
    browser: (
      <div className="space-y-8">
        <PageHeader
          sticky
          title="Browser"
          description="Manage browser profiles and their stored logins."
        />
        <BrowserSettingsCard />
      </div>
    ),
    repository: <RepositorySettingsPage />,
    storage: <StorageTabPage />,
    interface: <InterfaceSettingsPage />,
  };

  const currentContent = tabContent[activeTab];
  const searchResults = useMemo(
    () => searchSettings(searchQuery, { platform }),
    [platform, searchQuery]
  );
  const showingSearch = searchQuery.trim().length > 0;
  const handleSelectSearchResult = useCallback(
    (result: SettingsSearchResult) => {
      setSearchQuery('');
      onTargetSelect?.(result);
    },
    [onTargetSelect]
  );

  useEffect(() => {
    if (!target) return;

    const frame = window.requestAnimationFrame(() => {
      const scrolled = scrollSettingTargetIntoView(target);
      if (!scrolled) return;

      setHighlightedSettingId(target);
      window.setTimeout(() => {
        setHighlightedSettingId((current) => (current === target ? null : current));
      }, 4000);
    });

    return () => window.cancelAnimationFrame(frame);
  }, [target, highlightNonce, activeTab]);

  return (
    <SettingsHighlightProvider highlightedSettingId={highlightedSettingId}>
      <PageLayout
        sidebar={
          <div className="sticky top-0 self-start py-10 [-webkit-app-region:drag]">
            <div className="relative w-52 space-y-4 [-webkit-app-region:no-drag]">
              <SearchInput
                aria-label="Search settings"
                placeholder="Search settings..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && searchResults[0]) {
                    event.preventDefault();
                    handleSelectSearchResult(searchResults[0]);
                  }
                  if (event.key === 'Escape' && searchQuery) {
                    event.preventDefault();
                    setSearchQuery('');
                  }
                }}
                className="h-8 pr-8 text-sm"
              />
              {searchQuery && (
                <button
                  type="button"
                  className="absolute top-1.5 right-2 flex size-5 items-center justify-center rounded-sm text-foreground-muted hover:text-foreground"
                  aria-label="Clear settings search"
                  onClick={() => setSearchQuery('')}
                >
                  <X className="size-3.5" />
                </button>
              )}
              {!showingSearch && (
                <PageSidebarMenu
                  items={tabs}
                  activeId={activeTab}
                  className="static py-0"
                  onSelect={(item) => {
                    if (item.isExternal) {
                      handleDocsClick();
                    } else {
                      onTabChange(item.id);
                    }
                  }}
                />
              )}
            </div>
          </div>
        }
      >
        <PageContent>
          {showingSearch ? (
            <SettingsSearchResults
              query={searchQuery}
              results={searchResults}
              onSelect={handleSelectSearchResult}
            />
          ) : (
            currentContent
          )}
        </PageContent>
      </PageLayout>
    </SettingsHighlightProvider>
  );
}
