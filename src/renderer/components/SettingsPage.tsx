import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { Separator } from './ui/separator';
import type { SettingsPageTab } from '../hooks/useModalState';
import type { CliAgentStatus } from '../types/connections';
import { BASE_CLI_AGENTS } from './CliAgentsList';
import { Button } from './ui/button';

// Import existing settings cards
import TelemetryCard from './TelemetryCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import { UpdateCard } from './UpdateCard';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoTrustWorktreesRow,
} from './TaskSettingsRows';
import IntegrationsCard from './IntegrationsCard';
import Context7SettingsCard from './Context7SettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ThemeCard from './ThemeCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import RightSidebarSettingsCard from './RightSidebarSettingsCard';
import BrowserPreviewSettingsCard from './BrowserPreviewSettingsCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import CliAgentsList from './CliAgentsList';
import { useTaskSettings } from '../hooks/useTaskSettings';

// Helper functions from SettingsModal
const createDefaultCliAgents = (): CliAgentStatus[] =>
  BASE_CLI_AGENTS.map((agent) => ({ ...agent }));

const mergeCliAgents = (incoming: CliAgentStatus[]): CliAgentStatus[] => {
  const mergedMap = new Map<string, CliAgentStatus>();
  BASE_CLI_AGENTS.forEach((agent) => {
    mergedMap.set(agent.id, { ...agent });
  });
  incoming.forEach((agent) => {
    mergedMap.set(agent.id, {
      ...(mergedMap.get(agent.id) ?? {}),
      ...agent,
    });
  });
  return Array.from(mergedMap.values());
};

type CachedAgentStatus = {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  lastChecked?: number;
};

const mapAgentStatusesToCli = (
  statuses: Record<string, CachedAgentStatus | undefined>
): CliAgentStatus[] => {
  return Object.entries(statuses).reduce<CliAgentStatus[]>((acc, [agentId, status]) => {
    if (!status) return acc;
    const base = BASE_CLI_AGENTS.find((agent) => agent.id === agentId);
    acc.push({
      ...(base ?? {
        id: agentId,
        name: agentId,
        status: 'missing' as const,
        docUrl: null,
        installCommand: null,
      }),
      id: agentId,
      name: base?.name ?? agentId,
      status: status.installed ? 'connected' : 'missing',
      version: status.version ?? null,
      command: status.path ?? null,
    });
    return acc;
  }, []);
};

interface SettingsPageProps {
  initialTab?: SettingsPageTab;
  onClose: () => void;
}

interface SectionConfig {
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
}

const SettingsPage: React.FC<SettingsPageProps> = ({ initialTab, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsPageTab>(initialTab || 'general');
  const [cliAgents, setCliAgents] = useState<CliAgentStatus[]>(() => createDefaultCliAgents());
  const taskSettings = useTaskSettings();

  useEffect(() => {
    setActiveTab(initialTab || 'general');
  }, [initialTab]);

  // Load CLI agent statuses
  useEffect(() => {
    let cancelled = false;

    const applyCachedStatuses = (statuses: Record<string, CachedAgentStatus> | undefined) => {
      if (!statuses) return;
      const agents = mapAgentStatusesToCli(statuses);
      if (!agents.length) return;
      setCliAgents((prev) => mergeCliAgents([...prev, ...agents]));
    };

    const loadCachedStatuses = async () => {
      if (!window?.electronAPI?.getProviderStatuses) return;
      try {
        const result = await window.electronAPI.getProviderStatuses();
        if (cancelled) return;
        if (result?.success && result.statuses) {
          applyCachedStatuses(result.statuses);
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load cached CLI agent statuses:', error);
        }
      }
    };

    const off =
      window?.electronAPI?.onProviderStatusUpdated?.(
        (payload: { providerId: string; status: CachedAgentStatus }) => {
          if (!payload?.providerId || !payload.status) return;
          applyCachedStatuses({ [payload.providerId]: payload.status });
        }
      ) ?? null;

    void loadCachedStatuses();

    return () => {
      cancelled = true;
      off?.();
    };
  }, []);

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDocsClick = useCallback(() => {
    window.electronAPI.openExternal('https://docs.emdash.sh');
  }, []);

  const tabs: Array<{
    id: string;
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

  // Sort agents: detected first, then alphabetically
  const sortedAgents = React.useMemo(() => {
    return [...cliAgents].sort((a, b) => {
      if (a.status === 'connected' && b.status !== 'connected') return -1;
      if (b.status === 'connected' && a.status !== 'connected') return 1;
      return a.name.localeCompare(b.name);
    });
  }, [cliAgents]);

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
          component: <AutoGenerateTaskNamesRow taskSettings={taskSettings} />,
        },
        {
          component: <AutoApproveByDefaultRow taskSettings={taskSettings} />,
        },
        {
          component: <AutoTrustWorktreesRow taskSettings={taskSettings} />,
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
              <CliAgentsList agents={sortedAgents} isLoading={false} />
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
          title: 'Workspace',
          component: (
            <div className="flex flex-col gap-8 rounded-xl border border-muted p-4">
              <RightSidebarSettingsCard />
              <BrowserPreviewSettingsCard />
            </div>
          ),
        },
        {
          title: 'Tools',
          component: <HiddenToolsSettingsCard />,
        },
      ],
    },
  };

  const currentContent = tabContent[activeTab as keyof typeof tabContent];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-6 pb-0 pt-8">
      <div className="mx-auto flex h-full min-h-0 w-full max-w-[1060px] flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Manage your account settings and set preferences.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <Separator />
        </div>

        {/* Contents: Navigation + Content */}
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          {/* Navigation menu */}
          <nav className="flex min-h-0 w-52 flex-col gap-2 overflow-y-auto">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id && !tab.isExternal;

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.isExternal) {
                      handleDocsClick();
                    } else {
                      setActiveTab(tab.id as SettingsPageTab);
                    }
                  }}
                  className={`flex w-full items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
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

          {/* Content container */}
          {currentContent && (
            <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto pb-8">
              <div className="mx-auto w-full max-w-4xl space-y-8">
                {/* Page title */}
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-base font-medium">{currentContent.title}</h2>
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
};

export default SettingsPage;
