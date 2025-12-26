import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Button } from './ui/button';
import { Spinner } from './ui/spinner';
import { X, Settings2, Cable, RefreshCw, GitBranch, Puzzle, MessageSquare } from 'lucide-react';
import VersionCard from './VersionCard';
import IntegrationsCard from './IntegrationsCard';
import CliProvidersList, { BASE_CLI_PROVIDERS } from './CliProvidersList';
import TelemetryCard from './TelemetryCard';
import ThemeCard from './ThemeCard';
import BrowserPreviewSettingsCard from './BrowserPreviewSettingsCard';
import NotificationSettingsCard from './NotificationSettingsCard';
import RepositorySettingsCard from './RepositorySettingsCard';
import ProjectPrepSettingsCard from './ProjectPrepSettingsCard';
import Context7SettingsCard from './Context7SettingsCard';
import DefaultProviderSettingsCard from './DefaultProviderSettingsCard';
import TaskSettingsCard from './TaskSettingsCard';
import ChatUiSettingsCard from './ChatUiSettingsCard';
import AcpCommandsSettingsCard from './AcpCommandsSettingsCard';
import { CliProviderStatus } from '../types/connections';
import { Separator } from './ui/separator';

const createDefaultCliProviders = (): CliProviderStatus[] =>
  BASE_CLI_PROVIDERS.map((provider) => ({ ...provider }));

const mergeCliProviders = (incoming: CliProviderStatus[]): CliProviderStatus[] => {
  const mergedMap = new Map<string, CliProviderStatus>();

  BASE_CLI_PROVIDERS.forEach((provider) => {
    mergedMap.set(provider.id, { ...provider });
  });

  incoming.forEach((provider) => {
    mergedMap.set(provider.id, {
      ...(mergedMap.get(provider.id) ?? {}),
      ...provider,
    });
  });

  return Array.from(mergedMap.values());
};

type CachedProviderStatus = {
  installed: boolean;
  path?: string | null;
  version?: string | null;
  lastChecked?: number;
};

const mapProviderStatusesToCli = (
  statuses: Record<string, CachedProviderStatus | undefined>
): CliProviderStatus[] => {
  return Object.entries(statuses).reduce<CliProviderStatus[]>((acc, [providerId, status]) => {
    if (!status) return acc;
    const base = BASE_CLI_PROVIDERS.find((provider) => provider.id === providerId);
    acc.push({
      ...(base ?? {
        id: providerId,
        name: providerId,
        status: 'missing' as const,
        docUrl: null,
        installCommand: null,
      }),
      id: providerId,
      name: base?.name ?? providerId,
      status: status.installed ? 'connected' : 'missing',
      version: status.version ?? null,
      command: status.path ?? null,
    });
    return acc;
  }, []);
};

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTab = 'general' | 'acp' | 'repository' | 'connections' | 'mcp';

interface SettingsSection {
  title: string;
  description?: string;
  action?: React.ReactNode;
  render?: () => React.ReactNode;
}

const ORDERED_TABS: SettingsTab[] = ['general', 'acp', 'repository', 'mcp', 'connections'];

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [cliProviders, setCliProviders] = useState<CliProviderStatus[]>(() =>
    createDefaultCliProviders()
  );
  const [cliError, setCliError] = useState<string | null>(null);
  const [cliLoading, setCliLoading] = useState<boolean>(false);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    if (isOpen) {
      setActiveTab('general');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      void import('../lib/telemetryClient').then(({ captureTelemetry }) => {
        captureTelemetry('settings_tab_viewed', { tab: activeTab });
      });
    }
  }, [activeTab, isOpen]);

  useEffect(() => {
    let cancelled = false;

    const applyCachedStatuses = (statuses: Record<string, CachedProviderStatus> | undefined) => {
      if (!statuses) return;
      const providers = mapProviderStatusesToCli(statuses);
      if (!providers.length) return;
      setCliProviders((prev) => mergeCliProviders([...prev, ...providers]));
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
          console.error('Failed to load cached CLI provider statuses:', error);
        }
      }
    };

    const off =
      window?.electronAPI?.onProviderStatusUpdated?.(
        (payload: { providerId: string; status: CachedProviderStatus }) => {
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

  const fetchCliProviders = useCallback(async () => {
    if (!window?.electronAPI?.getProviderStatuses) {
      setCliProviders(createDefaultCliProviders());
      setCliError('Provider status detection is unavailable in this build.');
      return;
    }

    setCliLoading(true);
    setCliError(null);

    try {
      const result = await window.electronAPI.getProviderStatuses({ refresh: true });
      if (result?.success && result.statuses) {
        const providers = mapProviderStatusesToCli(result.statuses);
        setCliProviders((prev) => mergeCliProviders([...prev, ...providers]));
      } else {
        setCliError(result?.error || 'Failed to detect CLI providers.');
      }
    } catch (error) {
      console.error('CLI detection failed:', error);
      setCliError('Unable to detect CLI providers.');
    } finally {
      setCliLoading(false);
    }
  }, []);

  const tabDetails = useMemo(() => {
    return {
      general: {
        icon: Settings2,
        label: 'General',
        title: 'General',
        description: '',
        sections: [
          { title: 'Privacy & Telemetry', render: () => <TelemetryCard /> },
          { title: 'Default AI provider', render: () => <DefaultProviderSettingsCard /> },
          { title: 'Tasks', render: () => <TaskSettingsCard /> },
          { title: 'Notifications', render: () => <NotificationSettingsCard /> },
          { title: 'In‑app Browser Preview', render: () => <BrowserPreviewSettingsCard /> },
          { title: 'Project prep', render: () => <ProjectPrepSettingsCard /> },
          { title: 'Theme', render: () => <ThemeCard /> },
          { title: 'Version', render: () => <VersionCard /> },
          {
            title: 'How to use Emdash',
            render: () => (
              <div className="flex items-center">
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto px-0 text-xs"
                  onClick={() =>
                    window.electronAPI.openExternal(
                      'https://x.com/rabanspiegel/status/1991220598538924097?s=20'
                    )
                  }
                >
                  Watch the demo ↗
                </Button>
              </div>
            ),
          },
        ],
      },
      acp: {
        icon: MessageSquare,
        label: 'ACP',
        title: 'Agent Client Protocol (ACP)',
        sections: [
          { title: 'Chat UI (ACP)', render: () => <ChatUiSettingsCard /> },
          { title: 'Slash commands', render: () => <AcpCommandsSettingsCard /> },
        ],
      },
      repository: {
        icon: GitBranch,
        label: 'Repository',
        title: 'Repository',
        description: '',
        sections: [{ title: 'Branch creation', render: () => <RepositorySettingsCard /> }],
      },
      connections: {
        icon: Cable,
        label: 'Connections',
        title: 'Connections',
        description: '',
        sections: [
          { title: 'Integrations', render: () => <IntegrationsCard /> },
          {
            title: 'CLI providers',
            action: (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={fetchCliProviders}
                disabled={cliLoading}
                aria-busy={cliLoading}
                aria-label="Refresh CLI providers"
              >
                {cliLoading ? <Spinner size="sm" /> : <RefreshCw className="h-4 w-4" />}
              </Button>
            ),
            render: () => (
              <CliProvidersList providers={cliProviders} isLoading={cliLoading} error={cliError} />
            ),
          },
        ],
      },
      mcp: {
        icon: Puzzle,
        label: 'MCP',
        title: 'Model Context Protocol (MCP)',
        sections: [{ title: 'MCP Tools', render: () => <Context7SettingsCard /> }],
      },
    } as const;
  }, [cliProviders, cliLoading, cliError, fetchCliProviders]);

  const activeTabDetails = tabDetails[activeTab];

  const renderContent = () => {
    const { sections } = activeTabDetails;

    if (!sections.length) {
      return null;
    }

    return (
      <div className="space-y-6">
        {sections.map((section: SettingsSection, index) => {
          let renderedContent: React.ReactNode = null;
          if (typeof section.render === 'function') {
            renderedContent = section.render();
          } else if (!section.description) {
            renderedContent = <p className="text-sm text-muted-foreground">Coming soon.</p>;
          }

          return (
            <React.Fragment key={section.title}>
              {index > 0 ? <Separator className="border-border/60" /> : null}
              <section className="space-y-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-sm font-medium">{section.title}</h3>
                    {section.action ? <div>{section.action}</div> : null}
                  </div>
                  {section.description ? (
                    <p className="text-sm text-muted-foreground">{section.description}</p>
                  ) : null}
                </div>
                {renderedContent ? (
                  <div className="flex flex-col gap-3">{renderedContent}</div>
                ) : null}
              </section>
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(event) => event.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
            }
            className="mx-4 w-full max-w-3xl overflow-hidden rounded-2xl border border-border/50 bg-background shadow-2xl"
          >
            <div className="flex h-[520px]">
              <aside className="w-60 border-r border-border/60 bg-muted/20 p-6">
                <nav className="space-y-1">
                  {ORDERED_TABS.map((tab) => {
                    const { icon: Icon, label } = tabDetails[tab];

                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          activeTab === tab
                            ? 'bg-primary/10 text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60'
                        }`}
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-4 w-4" aria-hidden="true" />
                          <span>{label}</span>
                        </span>
                      </button>
                    );
                  })}
                </nav>
              </aside>

              <div className="flex flex-1 flex-col">
                <header className="flex items-center justify-between border-b border-border/60 px-6 py-4">
                  <div>
                    <h2 className="text-lg font-semibold">{activeTabDetails.title}</h2>
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
                </header>

                <div className="flex-1 overflow-y-auto px-6 py-6">{renderContent()}</div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default SettingsModal;
