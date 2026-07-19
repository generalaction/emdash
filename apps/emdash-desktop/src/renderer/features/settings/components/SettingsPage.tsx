import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { PageContent, PageLayout, PageSidebarMenu } from '@renderer/lib/components/page-layout';
import { rpc } from '@renderer/lib/ipc';
import { SearchInput } from '@renderer/lib/ui/search-input';
import { AgentsSettingsPage } from '../agents-page/AgentsSettingsPage';
import { matchedTabsForQuery, searchSettings } from '../search/settings-search';
import { SettingsSearchProvider } from '../search/settings-search-context';
import { SETTINGS_TABS, type SettingsPageTab } from '../settings-tabs';
import { AccountTab } from './AccountTab';
import { BrowserSettingsCard } from './BrowserSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import InterfaceSettingsCard from './InterfaceSettingsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ResourceMonitorSettingsCard from './ResourceMonitorSettingsCard';
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
    <div className="space-y-8">
      <PageHeader sticky title="Account" description="Manage your Emdash account." />
      <AccountTab />
    </div>
  );
}

function IntegrationsSettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader sticky title="Integrations" description="Connect external services and tools." />
      <IntegrationsCard />
    </div>
  );
}

function ConnectionsSettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        sticky
        title="Connections"
        description="Manage reusable SSH connections for remote projects."
      />
      <SshConnectionsSettingsCard />
    </div>
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
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Keyboard shortcuts</h3>
        <KeyboardSettingsCard />
      </div>
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Tools</h3>
        <HiddenToolsSettingsCard />
      </div>
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

function BrowserSettingsPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        sticky
        title="Browser"
        description="Manage browser profiles and their stored logins."
      />
      <BrowserSettingsCard />
    </div>
  );
}

const TAB_CONTENT: Record<Exclude<SettingsPageTab, 'docs'>, React.ComponentType> = {
  general: GeneralSettingsPage,
  account: AccountSettingsPage,
  'clis-models': AgentsSettingsPage,
  integrations: IntegrationsSettingsPage,
  connections: ConnectionsSettingsPage,
  browser: BrowserSettingsPage,
  repository: RepositorySettingsPage,
  storage: StorageTabPage,
  interface: InterfaceSettingsPage,
};

const DOCS_TAB = { id: 'docs', label: 'Docs', isExternal: true } as const;

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const query = searchQuery.trim();
  const isSearching = query.length > 0;

  const handleDocsClick = useCallback(() => {
    void rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const visibleTabs = useMemo(() => {
    if (!isSearching) return [...SETTINGS_TABS, DOCS_TAB];
    const matchedTabs = matchedTabsForQuery(query);
    const matchCountByTab = new Map<string, number>();
    for (const entry of searchSettings(query)) {
      matchCountByTab.set(entry.tab, (matchCountByTab.get(entry.tab) ?? 0) + 1);
    }
    return SETTINGS_TABS.filter((tab) => matchedTabs.includes(tab.id)).map((tab) => ({
      ...tab,
      badge: String(matchCountByTab.get(tab.id) ?? 0),
    }));
  }, [isSearching, query]);

  useEffect(() => {
    if (!isSearching || visibleTabs.length === 0) return;
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      onTabChange(visibleTabs[0].id);
    }
  }, [isSearching, visibleTabs, activeTab, onTabChange]);

  const Content =
    (activeTab !== 'docs' ? TAB_CONTENT[activeTab] : undefined) ?? GeneralSettingsPage;

  return (
    <PageLayout
      sidebar={
        <PageSidebarMenu
          header={
            <SearchInput
              placeholder="Search settings"
              aria-label="Search settings"
              aria-keyshortcuts="Meta+F Control+F /"
              shortcutHotkey="Mod+F"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== 'Escape') return;
                event.stopPropagation();

                if (searchQuery) {
                  setSearchQuery('');
                } else {
                  event.currentTarget.blur();
                }
              }}
              focusSlashHotkey
            />
          }
          emptyMessage="No matching settings"
          items={visibleTabs}
          activeId={activeTab}
          onSelect={(item) => {
            if (item.isExternal) {
              handleDocsClick();
            } else {
              onTabChange(item.id);
            }
          }}
        />
      }
    >
      <PageContent>
        <SettingsSearchProvider query={query}>
          <Content />
        </SettingsSearchProvider>
      </PageContent>
    </PageLayout>
  );
}
