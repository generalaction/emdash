import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ExternalLink, X } from 'lucide-react';
import { Separator } from './ui/separator';
import type { CliAgentStatus } from '../types/connections';
import { BASE_CLI_AGENTS, CliAgentsList } from './CliAgentsList';
import { Button } from './ui/button';
import SettingsSearchInput from './SettingsSearchInput';
import SettingsSearchResults from './SettingsSearchResults';
import { searchSettings } from '@/hooks/useSettingsSearch';

// Import existing settings cards
import TelemetryCard from './TelemetryCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import { UpdateCard } from './UpdateCard';
import DefaultAgentSettingsCard from './DefaultAgentSettingsCard';
import {
  AutoApproveByDefaultRow,
  AutoGenerateTaskNamesRow,
  AutoInferTaskNamesRow,
  CreateWorktreeByDefaultRow,
  AutoTrustWorktreesRow,
} from './TaskSettingsRows';
import IntegrationsCard from './IntegrationsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ThemeCard from './ThemeCard';
import KeyboardSettingsCard from './KeyboardSettingsCard';
import RightSidebarSettingsCard from './RightSidebarSettingsCard';
import BrowserPreviewSettingsCard from './BrowserPreviewSettingsCard';
import TaskHoverActionCard from './TaskHoverActionCard';
import TerminalSettingsCard from './TerminalSettingsCard';
import HiddenToolsSettingsCard from './HiddenToolsSettingsCard';
import ReviewAgentSettingsCard from './ReviewAgentSettingsCard';
import ResourceMonitorSettingsCard from './ResourceMonitorSettingsCard';
import { AccountTab } from './settings/AccountTab';
import { WorkspaceProviderInfoCard } from './WorkspaceProviderInfoCard';
import { useTaskSettings } from '../hooks/useTaskSettings';
import { EMDASH_DOCS_URL, getEmdashV1BetaUrl } from '@shared/urls';
import emdashBetaIcon from '../../assets/images/emdash/app-icon-beta-rounded.png';

export type SettingsPageTab =
  | 'general'
  | 'clis-models'
  | 'integrations'
  | 'repository'
  | 'interface'
  | 'docs'
  | 'account';

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

function getTabButtonClasses(isActive: boolean, isExternal: boolean): string {
  const base =
    'flex w-full items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors';
  if (isActive) return `${base} bg-muted text-foreground`;
  if (isExternal) return `${base} text-muted-foreground hover:bg-muted/60`;
  return `${base} text-foreground hover:bg-muted/60`;
}

interface SectionConfig {
  title?: string;
  action?: React.ReactNode;
  component: React.ReactNode;
}

function SettingsV1BetaNotice(): JSX.Element {
  const betaUrl = getEmdashV1BetaUrl('settings-update-section');

  return (
    <button
      type="button"
      onClick={() => window.electronAPI.openExternal(betaUrl)}
      className="group mb-4 flex w-full items-center justify-between gap-4 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-left transition-colors hover:bg-muted/35"
    >
      <img
        src={emdashBetaIcon}
        alt=""
        aria-hidden="true"
        className="h-10 w-10 flex-shrink-0 rounded-xl border border-border/50 bg-background object-cover shadow-sm"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-foreground">Emdash v1 is now available</p>
        </div>
        <p className="text-sm leading-5 text-muted-foreground">
          A new version of Emdash is ready to try from the download page.
        </p>
        <p className="text-sm leading-5 text-muted-foreground">
          You can import your old chats into v1 after installing it.
        </p>
      </div>
      <ArrowUpRight className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
    </button>
  );
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ initialTab, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsPageTab>(initialTab || 'general');
  const [cliAgents, setCliAgents] = useState<CliAgentStatus[]>(() => createDefaultCliAgents());
  const [searchQuery, setSearchQuery] = useState('');
  const taskSettings = useTaskSettings();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const trimmedSearchQuery = searchQuery.trim();
  const searchResults = useMemo(
    () => (trimmedSearchQuery ? searchSettings(trimmedSearchQuery) : []),
    [trimmedSearchQuery]
  );

  const handleSearchResultClick = useCallback((tabId: SettingsPageTab, elementId: string) => {
    setSearchQuery('');
    setActiveTab(tabId);

    // Scroll after React has re-rendered the newly active tab.
    requestAnimationFrame(() => {
      document.getElementById(elementId)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

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

  // Handle keyboard shortcuts (Escape to close, Cmd/Ctrl+F to focus search)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        onClose();
        return;
      }

      const isCmdF = (e.metaKey || e.ctrlKey) && e.key === 'f';
      if (isCmdF) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleDocsClick = useCallback(() => {
    window.electronAPI.openExternal(EMDASH_DOCS_URL);
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
    { id: 'account', label: 'Account' },
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
          component: <AutoInferTaskNamesRow taskSettings={taskSettings} />,
        },
        {
          component: <AutoApproveByDefaultRow taskSettings={taskSettings} />,
        },
        {
          component: <CreateWorktreeByDefaultRow taskSettings={taskSettings} />,
        },
        {
          component: <AutoTrustWorktreesRow taskSettings={taskSettings} />,
        },
        {
          component: <NotificationSettingsCard />,
        },
        {
          component: (
            <div id="settings-update-section" className="grid gap-3">
              <UpdateCard />
              <SettingsV1BetaNotice />
            </div>
          ),
        },
      ],
    },
    'clis-models': {
      title: 'Agents',
      description: 'Manage CLI agents and model configurations.',
      sections: [
        { component: <DefaultAgentSettingsCard /> },
        { component: <ReviewAgentSettingsCard /> },
        {
          title: 'CLI agents',
          component: (
            <div
              id="cli-agents-section"
              className="rounded-xl border border-border/60 bg-muted/10 p-2"
            >
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
        { component: <WorkspaceProviderInfoCard /> },
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
              <ResourceMonitorSettingsCard />
              <RightSidebarSettingsCard />
              <BrowserPreviewSettingsCard />
              <TaskHoverActionCard />
            </div>
          ),
        },
        {
          title: 'Tools',
          component: <HiddenToolsSettingsCard />,
        },
      ],
    },
    account: {
      title: 'Account',
      description: 'Manage your Emdash account.',
      sections: [{ component: <AccountTab /> }],
    },
  };

  const currentContent = tabContent[activeTab as keyof typeof tabContent];

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden px-6 pb-6 pt-8">
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
            <div className="flex items-center gap-2">
              <SettingsSearchInput
                ref={searchInputRef}
                query={searchQuery}
                onQueryChange={setSearchQuery}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-9 w-9 shrink-0"
                aria-label="Close settings"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <Separator />
        </div>

        {/* Contents: Navigation + Content */}
        <div className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)] gap-8 overflow-hidden">
          {/* Navigation menu */}
          <nav className="flex min-h-0 w-52 flex-col gap-2 overflow-y-auto pb-8 pr-2">
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
                  className={getTabButtonClasses(isActive, !!tab.isExternal)}
                >
                  <span className="text-left">{tab.label}</span>
                  {tab.isExternal && <ExternalLink className="h-4 w-4" />}
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-y-auto pr-2">
            <div className="mx-auto w-full max-w-4xl space-y-8 pb-10">
              {trimmedSearchQuery ? (
                <SettingsSearchResults
                  results={searchResults}
                  query={searchQuery}
                  onResultClick={handleSearchResultClick}
                />
              ) : (
                currentContent && (
                  <>
                    {/* Page title */}
                    <div className="flex flex-col gap-6">
                      <div className="flex flex-col gap-1">
                        <h2 className="text-base font-medium">{currentContent.title}</h2>
                        <p className="text-sm text-muted-foreground">
                          {currentContent.description}
                        </p>
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
                  </>
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
