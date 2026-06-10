import { ExternalLink } from 'lucide-react';
import React, { useCallback } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { rpc } from '@renderer/lib/ipc';
import { cn } from '@renderer/utils/utils';
import { AgentsSettingsPage } from '../agents-page/AgentsSettingsPage';
import { AccountTab } from './AccountTab';
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

// ---------------------------------------------------------------------------
// Tab page components
// ---------------------------------------------------------------------------

function GeneralSettingsPage() {
  return (
    <div className="space-y-8 pt-10">
      <PageHeader
        title="General"
        description="Manage your account, privacy settings, notifications, and app updates."
      />
      <TelemetryCard />
      <AutoGenerateTaskNamesRow />
      <AutoTrustWorktreesRow />
      <CreateBranchAndWorktreeRow />
      <PreserveTaskNameCapitalizationRow />
      <IncludeIssueContextByDefaultRow />
      <EnableTmuxRow />
      <NotificationSettingsCard />
      <UpdateCard />
    </div>
  );
}

function AccountSettingsPage() {
  return (
    <div className="pt-10 space-y-8">
      <PageHeader title="Account" description="Manage your Emdash account." />
      <AccountTab />
    </div>
  );
}

function IntegrationsSettingsPage() {
  return (
    <div className="pt-10 space-y-8">
      <PageHeader title="Integrations" description="Connect external services and tools." />
      <IntegrationsCard />
    </div>
  );
}

function ConnectionsSettingsPage() {
  return (
    <div className="pt-10 space-y-8">
      <PageHeader
        title="Connections"
        description="Manage reusable SSH connections for remote projects."
      />
      <SshConnectionsSettingsCard />
    </div>
  );
}

function RepositorySettingsPage() {
  return (
    <div className="pt-10 space-y-8">
      <PageHeader title="Repository" description="Configure repository and branch settings." />
      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-normal text-foreground">Branch prefix</h3>
        <RepositorySettingsCard />
      </div>
    </div>
  );
}

function InterfaceSettingsPage() {
  return (
    <div className="pt-10 space-y-8">
      <PageHeader
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

// ---------------------------------------------------------------------------
// SettingsPage
// ---------------------------------------------------------------------------

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
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

  const tabContent: Record<string, React.ReactNode> = {
    general: <GeneralSettingsPage />,
    account: <AccountSettingsPage />,
    'clis-models': <AgentsSettingsPage />,
    integrations: <IntegrationsSettingsPage />,
    connections: <ConnectionsSettingsPage />,
    repository: <RepositorySettingsPage />,
    interface: <InterfaceSettingsPage />,
  };

  const currentContent = tabContent[activeTab];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
      <div className="h-full scrollbar-gutter-stable overflow-x-hidden overflow-y-auto">
        <div className="mx-auto w-full max-w-[1060px] px-8">
          <div className="grid w-full grid-cols-[13rem_minmax(0,1fr)] gap-8">
            <div className="sticky top-0 self-start py-10">
              <nav className="flex w-52 flex-col gap-0.5">
                {tabs.map((tab) => {
                  const isActive = tab.id === activeTab && !tab.isExternal;
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
            </div>
            {currentContent && (
              <div className="mx-auto w-full max-w-4xl px-4">{currentContent}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
