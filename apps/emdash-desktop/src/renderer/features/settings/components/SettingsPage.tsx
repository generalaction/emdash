import React, { useCallback } from 'react';
import { PageHeader } from '@renderer/lib/components/page-header';
import { PageContent, PageLayout, PageSidebarMenu } from '@renderer/lib/components/page-layout';
import { rpc } from '@renderer/lib/ipc';
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
    <div className="space-y-8 pb-10">
      <PageHeader
        sticky
        title="General"
        description="Manage your account, privacy settings, notifications, and app updates."
      />
      <UpdateCard />
      <TelemetryCard />
      <AutoGenerateTaskNamesRow />
      <AutoTrustWorktreesRow />
      <CreateBranchAndWorktreeRow />
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
    <PageLayout
      sidebar={
        <PageSidebarMenu
          items={tabs}
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
      {currentContent && <PageContent>{currentContent}</PageContent>}
    </PageLayout>
  );
}
