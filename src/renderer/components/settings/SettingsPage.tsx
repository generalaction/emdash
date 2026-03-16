import { ExternalLink } from 'lucide-react';
import React, { useCallback } from 'react';
import { useViewParams } from '@renderer/core/view/navigation-provider';
import { rpc } from '@renderer/lib/ipc';
import DefaultAgentSettingsCard from '../DefaultAgentSettingsCard';
import TerminalSettingsCard from '../TerminalSettingsCard';
import ThemeCard from '../ThemeCard';
import { Separator } from '../ui/separator';
import { CliAgentsList } from './CliAgentsList';
import Context7SettingsCard from './Context7SettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import IntegrationsCard from './IntegrationsCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
} from './TaskSettingsRows';
import TelemetryCard from './TelemetryCard';
import { UpdateCard } from './UpdateCard';

export type SettingsPageTab =
  | 'general'
  | 'clis-models'
  | 'integrations'
  | 'repository'
  | 'interface'
  | 'docs';

interface SectionConfig {
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
}

export function SettingsPage({
  tab: activeTab,
  onTabChange,
}: {
  tab: SettingsPageTab;
  onTabChange: (tab: SettingsPageTab) => void;
}) {
  const handleDocsClick = useCallback(() => {
    rpc.app.openExternal('https://docs.emdash.sh');
  }, []);

  const tabs: Array<{
    id: SettingsPageTab;
    label: string;
    isExternal?: boolean;
  }> = [
    { id: 'general', label: 'General' },
    { id: 'clis-models', label: 'Agents' },
    { id: 'integrations', label: 'Integrations' },
    { id: 'repository', label: 'Repository' },
    { id: 'interface', label: 'Interface' },
    { id: 'docs', label: 'Docs', isExternal: true },
  ];

  const tabContent: Record<
    string,
    { title: string; description: string; sections: SectionConfig[] }
  > = {
    general: {
      title: 'General',
      description: 'Manage your account, privacy settings, notifications, and app updates.',
      sections: [
        {
          component: <TelemetryCard />,
        },
        {
          component: <AutoGenerateTaskNamesRow />,
        },
        {
          component: <AutoApproveByDefaultRow />,
        },
        {
          component: <AutoTrustWorktreesRow />,
        },
        {
          component: <NotificationSettingsCard />,
        },
        {
          component: <UpdateCard />,
        },
      ],
    },
    'clis-models': {
      title: 'Agents',
      description: 'Manage CLI agents and model configurations.',
      sections: [
        { component: <DefaultAgentSettingsCard /> },
        {
          title: 'CLI agents',
          component: (
            <div className="rounded-xl border border-border/60 bg-muted/10 p-2">
              <CliAgentsList />
            </div>
          ),
        },
      ],
    },
    integrations: {
      title: 'Integrations',
      description: 'Connect external services and tools.',
      sections: [
        { title: 'Integrations', component: <IntegrationsCard /> },
        { title: 'MCP Server', component: <Context7SettingsCard /> },
      ],
    },
    repository: {
      title: 'Repository',
      description: 'Configure repository and branch settings.',
      sections: [{ title: 'Branch name', component: <RepositorySettingsCard /> }],
    },
    interface: {
      title: 'Interface',
      description: 'Customize the appearance and behavior of the app.',
      sections: [
        { component: <ThemeCard /> },
        { component: <TerminalSettingsCard /> },
        { title: 'Keyboard shortcuts', component: <KeyboardSettingsCard /> },
        {
          title: 'Tools',
          component: <HiddenToolsSettingsCard />,
        },
      ],
    },
  };

  const currentContent = tabContent[activeTab as keyof typeof tabContent];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden ">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6 px-8">
        {/* Contents: Navigation + Content */}
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          {/* Navigation menu */}
          <div className="py-10">
            <div className="flex flex-col gap-1 px-3">
              <h1 className="text-xl font-medium">Settings</h1>
              {/* <p className="text-sm text-muted-foreground">
                Manage your account settings and set preferences.
              </p> */}
            </div>
            <nav className="flex min-h-0 w-52 flex-col gap-1 overflow-y-auto pt-8">
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
                    className={`flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-normal transition-colors ${
                      isActive
                        ? 'bg-muted text-foreground'
                        : tab.isExternal
                          ? 'text-muted-foreground hover:bg-muted/60'
                          : 'text-foreground hover:bg-muted/60'
                    }`}
                  >
                    <span className="text-left">{tab.label}</span>
                    {tab.isExternal && <ExternalLink className="h-4 w-4" />}
                  </button>
                );
              })}
            </nav>
          </div>
          {/* Content container */}
          {currentContent && (
            <div className="min-h-0 min-w-0 flex-1 justify-center overflow-y-auto">
              <div className="mx-auto w-full max-w-4xl space-y-8 py-10">
                {/* Page title */}
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-xl font-medium">{currentContent.title}</h2>
                    <p className="text-sm text-muted-foreground">{currentContent.description}</p>
                  </div>
                  <Separator />
                </div>

                {/* Sections */}
                {currentContent.sections.map((section, index) => (
                  <div key={index} className="flex flex-col gap-3">
                    {section.title && (
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-medium text-foreground">{section.title}</h3>
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
