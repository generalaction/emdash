import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ExternalLink, Globe, Database, Server, ChevronDown } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import ContainerStatusBadge from './ContainerStatusBadge';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import { TerminalPane } from './TerminalPane';
import InstallBanner from './InstallBanner';
import { providerMeta } from '../providers/meta';
import ProviderBar from './ProviderBar';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { usePlanMode } from '@/hooks/usePlanMode';
import { usePlanActivationTerminal } from '@/hooks/usePlanActivation';
import { log } from '@/lib/logger';
import { logPlanEvent } from '@/lib/planLogs';
import { type Provider } from '../types';
import { Task } from '../types/chat';
import {
  getContainerRunState,
  subscribeToTaskRunState,
  type ContainerRunState,
} from '@/lib/containerRuns';
import { useBrowser } from '@/providers/BrowserProvider';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import { TaskScopeProvider } from './TaskScopeContext';

declare const window: Window & {
  electronAPI: {
    saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  };
};

interface Props {
  task: Task;
  projectName: string;
  className?: string;
  initialProvider?: Provider;
}

const ChatInterface: React.FC<Props> = ({
  task,
  projectName: _projectName,
  className,
  initialProvider,
}) => {
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const [isProviderInstalled, setIsProviderInstalled] = useState<boolean | null>(null);
  const [providerStatuses, setProviderStatuses] = useState<
    Record<string, { installed?: boolean; path?: string | null; version?: string | null }>
  >({});
  const [provider, setProvider] = useState<Provider>(initialProvider || 'codex');
  const currentProviderStatus = providerStatuses[provider];
  const browser = useBrowser();
  const [cliStartFailed, setCliStartFailed] = useState(false);
  const [containerState, setContainerState] = useState<ContainerRunState | undefined>(() =>
    getContainerRunState(task.id)
  );
  const reduceMotion = useReducedMotion();
  const terminalId = useMemo(() => `${provider}-main-${task.id}`, [provider, task.id]);
  const [portsExpanded, setPortsExpanded] = useState(false);
  const { activeTerminalId } = useTaskTerminals(task.id, task.path);

  // Line comments for agent context injection
  const { formatted: commentsContext } = useTaskComments(task.id);

  // Auto-scroll to bottom when this task becomes active
  useAutoScrollOnTaskSwitch(true, task.id);

  // Auto-focus terminal when switching to this task
  useEffect(() => {
    // Small delay to ensure terminal is mounted and attached
    const timer = setTimeout(() => {
      const session = terminalSessionRegistry.getSession(terminalId);
      if (session) {
        session.focus();
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [task.id, terminalId]);

  // Unified Plan Mode (per task)
  const { enabled: planEnabled, setEnabled: setPlanEnabled } = usePlanMode(task.id, task.path);

  // Log transitions for visibility
  useEffect(() => {
    log.info('[plan] state changed', { taskId: task.id, enabled: planEnabled });
  }, [planEnabled, task.id]);

  // For terminal providers with native plan activation commands
  usePlanActivationTerminal({
    enabled: planEnabled,
    providerId: provider,
    taskId: task.id,
    taskPath: task.path,
  });

  useEffect(() => {
    const meta = providerMeta[provider];
    if (!meta?.terminalOnly || !meta.autoStartCommand) return;

    const onceKey = `cli:autoStart:${terminalId}`;
    try {
      if (localStorage.getItem(onceKey) === '1') return;
    } catch {}

    const send = () => {
      try {
        (window as any).electronAPI?.ptyInput?.({
          id: terminalId,
          data: `${meta.autoStartCommand}\n`,
        });
        try {
          localStorage.setItem(onceKey, '1');
        } catch {}
      } catch {}
    };

    const api: any = (window as any).electronAPI;
    let off: (() => void) | null = null;
    try {
      off = api?.onPtyStarted?.((info: { id: string }) => {
        if (info?.id === terminalId) send();
      });
    } catch {}

    const t = setTimeout(send, 1200);

    return () => {
      try {
        off?.();
      } catch {}
      clearTimeout(t);
    };
  }, [provider, terminalId]);

  useEffect(() => {
    setCliStartFailed(false);
    setIsProviderInstalled(null);
    setContainerState(getContainerRunState(task.id));
  }, [task.id]);

  const runInstallCommand = useCallback(
    (cmd: string) => {
      const api: any = (window as any).electronAPI;
      const targetId = activeTerminalId;
      if (!targetId) return;

      const send = () => {
        try {
          api?.ptyInput?.({ id: targetId, data: `${cmd}\n` });
          return true;
        } catch (error) {
          console.error('Failed to run install command', error);
          return false;
        }
      };

      // Best effort immediate send
      const ok = send();

      // Listen for PTY start in case the terminal was still spinning up
      const off = api?.onPtyStarted?.((info: { id: string }) => {
        if (info?.id !== targetId) return;
        send();
        try {
          off?.();
        } catch {}
      });

      // If immediate send worked, remove listener
      if (ok) {
        try {
          off?.();
        } catch {}
      }
    },
    [activeTerminalId]
  );

  // Auto-expand/collapse ports in chat view based on container activity
  useEffect(() => {
    const status = containerState?.status;
    const active = status === 'starting' || status === 'building' || status === 'ready';
    if (status === 'ready' && (containerState?.ports?.length ?? 0) > 0) setPortsExpanded(true);
    if (!active) setPortsExpanded(false);
  }, [containerState?.status, containerState?.ports?.length]);

  // On task change, restore last-selected provider (including Droid).
  // If a locked provider exists (including Droid), prefer locked.
  useEffect(() => {
    try {
      const lastKey = `provider:last:${task.id}`;
      const last = window.localStorage.getItem(lastKey) as Provider | null;

      if (initialProvider) {
        setProvider(initialProvider);
      } else {
        const validProviders: Provider[] = [
          'qwen',
          'codex',
          'claude',
          'droid',
          'gemini',
          'cursor',
          'copilot',
          'amp',
          'opencode',
          'charm',
          'auggie',
          'kimi',
          'kiro',
          'rovo',
        ];
        if (last && (validProviders as string[]).includes(last)) {
          setProvider(last as Provider);
        } else {
          setProvider('codex');
        }
      }
    } catch {
      setProvider(initialProvider || 'codex');
    }
  }, [task.id, initialProvider]);

  // Persist last-selected provider per task (including Droid)
  useEffect(() => {
    try {
      window.localStorage.setItem(`provider:last:${task.id}`, provider);
    } catch {}
  }, [provider, task.id]);

  // Track provider switching
  const prevProviderRef = React.useRef<Provider | null>(null);
  useEffect(() => {
    if (prevProviderRef.current && prevProviderRef.current !== provider) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_provider_switched', { provider });
      })();
    }
    prevProviderRef.current = provider;
  }, [provider]);

  useEffect(() => {
    const installed = currentProviderStatus?.installed === true;
    setIsProviderInstalled(installed);
  }, [provider, currentProviderStatus]);

  useEffect(() => {
    let cancelled = false;
    let missingCheckRequested = false;
    const api: any = (window as any).electronAPI;

    const applyStatuses = (statuses: Record<string, any> | undefined | null) => {
      if (!statuses) return;
      setProviderStatuses(statuses);
      if (cancelled) return;
      const installed = statuses?.[provider]?.installed === true;
      setIsProviderInstalled(installed);
    };

    const maybeRefreshMissing = async (statuses?: Record<string, any> | undefined | null) => {
      if (cancelled || missingCheckRequested) return;
      if (!api?.getProviderStatuses) return;
      if (statuses && statuses[provider]) return;
      missingCheckRequested = true;
      try {
        const refreshed = await api.getProviderStatuses({ refresh: true, providers: [provider] });
        if (cancelled) return;
        if (refreshed?.success) {
          applyStatuses(refreshed.statuses ?? {});
        }
      } catch (error) {
        console.error('Provider status refresh failed', error);
      }
    };

    const load = async () => {
      if (!api?.getProviderStatuses) {
        setIsProviderInstalled(false);
        return;
      }
      try {
        const res = await api.getProviderStatuses();
        if (cancelled) return;
        if (res?.success) {
          applyStatuses(res.statuses ?? {});
          void maybeRefreshMissing(res.statuses);
        } else {
          setIsProviderInstalled(false);
        }
      } catch (error) {
        if (!cancelled) setIsProviderInstalled(false);
        console.error('Provider status load failed', error);
      }
    };

    const off =
      api?.onProviderStatusUpdated?.((payload: { providerId: string; status: any }) => {
        if (!payload?.providerId) return;
        setProviderStatuses((prev) => {
          const next = { ...prev, [payload.providerId]: payload.status };
          return next;
        });
        if (payload.providerId === provider) {
          setIsProviderInstalled(payload.status?.installed === true);
        }
      }) || null;

    void load();

    return () => {
      cancelled = true;
      off?.();
    };
  }, [provider, task.id]);

  // If we don't even have a cached status entry for the current provider, pessimistically
  // show the install banner and kick off a background refresh to populate it.
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.getProviderStatuses) {
      setIsProviderInstalled(false);
      return;
    }
    if (currentProviderStatus) {
      return;
    }

    let cancelled = false;
    setIsProviderInstalled(false);

    (async () => {
      try {
        const res = await api.getProviderStatuses({ refresh: true, providers: [provider] });
        if (cancelled) return;
        if (res?.success) {
          const statuses = res.statuses ?? {};
          setProviderStatuses(statuses);
          const installed = statuses?.[provider]?.installed === true;
          setIsProviderInstalled(installed);
        }
      } catch (error) {
        if (!cancelled) {
          setIsProviderInstalled(false);
        }
        console.error('Provider status refresh (missing entry) failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [provider, currentProviderStatus]);

  // When switching providers, ensure other streams are stopped
  useEffect(() => {
    (async () => {
      try {
      } catch {}
    })();
  }, [provider, task.id]);

  const isTerminal = providerMeta[provider]?.terminalOnly === true;
  const autoApproveEnabled =
    Boolean(task.metadata?.autoApprove) && Boolean(providerMeta[provider]?.autoApproveFlag);

  const initialInjection = useMemo(() => {
    if (!isTerminal) return null;
    const md = task.metadata || null;
    const p = (md?.initialPrompt || '').trim();
    if (p) return p;
    const issue = md?.linearIssue;
    if (issue) {
      const parts: string[] = [];
      const line1 = `Linked Linear issue: ${issue.identifier}${issue.title ? ` — ${issue.title}` : ''}`;
      parts.push(line1);
      const details: string[] = [];
      if (issue.state?.name) details.push(`State: ${issue.state.name}`);
      if (issue.assignee?.displayName || issue.assignee?.name)
        details.push(`Assignee: ${issue.assignee?.displayName || issue.assignee?.name}`);
      if (issue.team?.key) details.push(`Team: ${issue.team.key}`);
      if (issue.project?.name) details.push(`Project: ${issue.project.name}`);
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (issue.url) parts.push(`URL: ${issue.url}`);
      const desc = (issue as any)?.description;
      if (typeof desc === 'string' && desc.trim()) {
        const trimmed = desc.trim();
        const max = 1500;
        const body = trimmed.length > max ? trimmed.slice(0, max) + '\n…' : trimmed;
        parts.push('', 'Issue Description:', body);
      }
      const linearContent = parts.join('\n');
      // Prepend comments if any
      if (commentsContext) {
        return `The user has left the following comments on the code changes:\n\n${commentsContext}\n\n${linearContent}`;
      }
      return linearContent;
    }

    const gh = (md as any)?.githubIssue as
      | {
          number: number;
          title?: string;
          url?: string;
          state?: string;
          assignees?: any[];
          labels?: any[];
          body?: string;
        }
      | undefined;
    if (gh) {
      const parts: string[] = [];
      const line1 = `Linked GitHub issue: #${gh.number}${gh.title ? ` — ${gh.title}` : ''}`;
      parts.push(line1);
      const details: string[] = [];
      if (gh.state) details.push(`State: ${gh.state}`);
      try {
        const as = Array.isArray(gh.assignees)
          ? gh.assignees
              .map((a: any) => a?.name || a?.login)
              .filter(Boolean)
              .join(', ')
          : '';
        if (as) details.push(`Assignees: ${as}`);
      } catch {}
      try {
        const ls = Array.isArray(gh.labels)
          ? gh.labels
              .map((l: any) => l?.name)
              .filter(Boolean)
              .join(', ')
          : '';
        if (ls) details.push(`Labels: ${ls}`);
      } catch {}
      if (details.length) parts.push(`Details: ${details.join(' • ')}`);
      if (gh.url) parts.push(`URL: ${gh.url}`);
      const body = typeof gh.body === 'string' ? gh.body.trim() : '';
      if (body) {
        const max = 1500;
        const clipped = body.length > max ? body.slice(0, max) + '\n…' : body;
        parts.push('', 'Issue Description:', clipped);
      }
      const ghContent = parts.join('\n');
      // Prepend comments if any
      if (commentsContext) {
        return `The user has left the following comments on the code changes:\n\n${commentsContext}\n\n${ghContent}`;
      }
      return ghContent;
    }

    const j = md?.jiraIssue as any;
    if (j) {
      const lines: string[] = [];
      const l1 = `Linked Jira issue: ${j.key}${j.summary ? ` — ${j.summary}` : ''}`;
      lines.push(l1);
      const details: string[] = [];
      if (j.status?.name) details.push(`Status: ${j.status.name}`);
      if (j.assignee?.displayName || j.assignee?.name)
        details.push(`Assignee: ${j.assignee?.displayName || j.assignee?.name}`);
      if (j.project?.key) details.push(`Project: ${j.project.key}`);
      if (details.length) lines.push(`Details: ${details.join(' • ')}`);
      if (j.url) lines.push(`URL: ${j.url}`);
      const jiraContent = lines.join('\n');
      // Prepend comments if any
      if (commentsContext) {
        return `The user has left the following comments on the code changes:\n\n${commentsContext}\n\n${jiraContent}`;
      }
      return jiraContent;
    }

    // If we have comments but no other context, return just the comments
    if (commentsContext) {
      return `The user has left the following comments on the code changes:\n\n${commentsContext}`;
    }

    return null;
  }, [isTerminal, task.metadata, commentsContext]);

  // Only use keystroke injection for providers WITHOUT CLI flag support
  // Providers with initialPromptFlag use CLI arg injection via TerminalPane instead
  useInitialPromptInjection({
    taskId: task.id,
    providerId: provider,
    prompt: initialInjection,
    enabled: isTerminal && providerMeta[provider]?.initialPromptFlag === undefined,
  });

  // Ensure a provider is stored for this task so fallbacks can subscribe immediately
  useEffect(() => {
    try {
      localStorage.setItem(`taskProvider:${task.id}`, provider);
    } catch {}
  }, [provider, task.id]);

  useEffect(() => {
    const off = subscribeToTaskRunState(task.id, (state) => {
      setContainerState(state);
    });
    return () => {
      off?.();
    };
  }, [task.id]);

  const containerStatusNode = useMemo(() => {
    const state = containerState;
    if (!state?.runId) return null;
    const ports = state.ports ?? [];
    const containerActive =
      state.status === 'starting' || state.status === 'building' || state.status === 'ready';
    if (!containerActive) return null;

    const norm = (s: string) => s.toLowerCase();
    const sorted = [...ports].sort((a, b) => {
      const ap = state.previewService && norm(state.previewService) === norm(a.service);
      const bp = state.previewService && norm(state.previewService) === norm(b.service);
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;
      const an = norm(a.service);
      const bn = norm(b.service);
      if (an !== bn) return an < bn ? -1 : 1;
      if (a.container !== b.container) return a.container - b.container;
      return a.host - b.host;
    });

    const ServiceIcon: React.FC<{ name: string; port: number }> = ({ name, port }) => {
      const [src, setSrc] = React.useState<string | null>(null);
      React.useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const api: any = (window as any).electronAPI;
            if (!api?.resolveServiceIcon) return;
            // Allow network fetch in production to populate cache/offline use
            const res = await api.resolveServiceIcon({
              service: name,
              allowNetwork: true,
              taskPath: task.path,
            });
            if (!cancelled && res?.ok && typeof res.dataUrl === 'string') setSrc(res.dataUrl);
          } catch {}
        })();
        return () => {
          cancelled = true;
        };
      }, [name]);
      if (src) return <img src={src} alt="" className="h-3.5 w-3.5 rounded-sm" />;
      const webPorts = new Set([80, 443, 3000, 5173, 8080, 8000]);
      const dbPorts = new Set([5432, 3306, 27017, 1433, 1521]);
      if (webPorts.has(port)) return <Globe className="h-3.5 w-3.5" aria-hidden="true" />;
      if (dbPorts.has(port)) return <Database className="h-3.5 w-3.5" aria-hidden="true" />;
      return <Server className="h-3.5 w-3.5" aria-hidden="true" />;
    };
    const isMultiAgent = task.metadata?.multiAgent?.enabled === true;
    return (
      <div className="mt-4 px-6">
        <div className="mx-auto max-w-4xl rounded-md border border-border bg-muted/20 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="font-medium text-foreground">
              {!isMultiAgent ? (
                <ContainerStatusBadge
                  active={
                    state.status === 'starting' ||
                    state.status === 'building' ||
                    state.status === 'ready'
                  }
                  isStarting={state.status === 'starting' || state.status === 'building'}
                  isReady={state.status === 'ready'}
                  startingAction={false}
                  stoppingAction={false}
                  onStart={() => {}}
                  onStop={() => {}}
                  showStop={false}
                />
              ) : null}
              {state.containerId ? (
                <span className="ml-2 text-xs text-muted-foreground">#{state.containerId}</span>
              ) : null}
            </div>
            <div className="flex items-center gap-2">
              {containerActive ? (
                <button
                  type="button"
                  onClick={() => setPortsExpanded((v) => !v)}
                  className="inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-border/70 bg-background px-2.5 text-xs font-medium"
                  aria-expanded={portsExpanded}
                  aria-controls={`chat-ports-${task.id}`}
                >
                  <ChevronDown
                    className={[
                      'h-3.5 w-3.5 transition-transform',
                      portsExpanded ? 'rotate-180' : '',
                    ].join(' ')}
                    aria-hidden="true"
                  />
                  Ports
                </button>
              ) : null}
              {state.previewUrl ? (
                <>
                  <button
                    type="button"
                    className="inline-flex items-center rounded border border-primary/60 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/10"
                    onClick={() => window.electronAPI.openExternal(state.previewUrl!)}
                    aria-label="Open preview (external)"
                    title="Open preview"
                  >
                    Open Preview
                    <ExternalLink className="ml-1.5 h-3 w-3" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="inline-flex items-center rounded border border-border px-2 py-1 text-xs font-medium hover:bg-muted"
                    onClick={() => browser.open(state.previewUrl!)}
                    aria-label="Open preview (in‑app)"
                    title="Open in app"
                  >
                    Open In App
                    <Globe className="ml-1.5 h-3 w-3" aria-hidden="true" />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <AnimatePresence initial={false}>
            {portsExpanded && sorted.length ? (
              <motion.div
                id={`chat-ports-${task.id}`}
                className="text-xs text-muted-foreground"
                initial={reduceMotion ? false : { opacity: 0, height: 0, paddingTop: 0 }}
                animate={{ opacity: 1, height: 'auto', paddingTop: 8 }}
                exit={
                  reduceMotion
                    ? { opacity: 1, height: 'auto', paddingTop: 0 }
                    : { opacity: 0, height: 0, paddingTop: 0 }
                }
                transition={
                  reduceMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 1, 0.36, 1] }
                }
                style={{ overflow: 'hidden', display: 'grid' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 font-medium text-foreground">
                      Ports
                    </span>
                    <span>Mapped host → container per service</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  {sorted.map((port) => (
                    <span
                      key={`${state.runId}-${port.service}-${port.host}`}
                      className="inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1"
                    >
                      <span className="inline-flex items-center gap-1.5 text-foreground">
                        <ServiceIcon name={port.service} port={port.container} />
                        <span className="font-medium">{port.service}</span>
                      </span>
                      <span>host {port.host}</span>
                      <span>→</span>
                      <span>container {port.container}</span>
                      {state.previewService === port.service ? (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-primary">
                          preview
                        </span>
                      ) : null}
                    </span>
                  ))}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
          {state.lastError ? (
            <div className="mt-2 rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive">
              {state.lastError.message}
            </div>
          ) : null}
        </div>
      </div>
    );
  }, [containerState, portsExpanded, reduceMotion, task.id, task.path]);

  if (!isTerminal) {
    return null;
  }

  return (
    <TaskScopeProvider value={{ taskId: task.id, taskPath: task.path }}>
      <div
        className={`flex h-full flex-col ${effectiveTheme === 'dark-black' ? 'bg-black' : 'bg-card'} ${className}`}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <div className="mx-auto max-w-4xl space-y-2">
              {(() => {
                if (isProviderInstalled !== true) {
                  return (
                    <InstallBanner
                      provider={provider as any}
                      terminalId={terminalId}
                      installCommand={getInstallCommandForProvider(provider as any)}
                      onRunInstall={runInstallCommand}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                if (cliStartFailed) {
                  return (
                    <InstallBanner
                      provider={provider as any}
                      terminalId={terminalId}
                      onRunInstall={runInstallCommand}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                return null;
              })()}
            </div>
          </div>
          {containerStatusNode}
          <div className="mt-4 min-h-0 flex-1 px-6">
            <div
              className={`mx-auto h-full max-w-4xl overflow-hidden rounded-md ${
                provider === 'charm'
                  ? effectiveTheme === 'dark-black'
                    ? 'bg-black'
                    : effectiveTheme === 'dark'
                      ? 'bg-card'
                      : 'bg-white'
                  : provider === 'mistral'
                    ? effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                      ? effectiveTheme === 'dark-black'
                        ? 'bg-[#141820]'
                        : 'bg-[#202938]'
                      : 'bg-white'
                    : ''
              }`}
            >
              <TerminalPane
                id={terminalId}
                cwd={task.path}
                shell={providerMeta[provider].cli}
                autoApprove={autoApproveEnabled}
                env={
                  planEnabled
                    ? {
                        EMDASH_PLAN_MODE: '1',
                        EMDASH_PLAN_FILE: `${task.path}/.emdash/planning.md`,
                      }
                    : undefined
                }
                keepAlive={true}
                onActivity={() => {
                  try {
                    window.localStorage.setItem(`provider:locked:${task.id}`, provider);
                  } catch {}
                }}
                onStartError={() => {
                  setCliStartFailed(true);
                }}
                onStartSuccess={() => {
                  setCliStartFailed(false);
                  // Mark initial injection as sent so it won't re-run on restart
                  if (initialInjection && !task.metadata?.initialInjectionSent) {
                    void window.electronAPI.saveTask({
                      ...task,
                      metadata: {
                        ...task.metadata,
                        initialInjectionSent: true,
                      },
                    });
                  }
                }}
                variant={
                  effectiveTheme === 'dark' || effectiveTheme === 'dark-black' ? 'dark' : 'light'
                }
                themeOverride={
                  provider === 'charm'
                    ? {
                        background:
                          effectiveTheme === 'dark-black'
                            ? '#0a0a0a'
                            : effectiveTheme === 'dark'
                              ? '#1f2937'
                              : '#ffffff',
                        selectionBackground: 'rgba(96, 165, 250, 0.35)',
                        selectionForeground: effectiveTheme === 'light' ? '#0f172a' : '#f9fafb',
                      }
                    : provider === 'mistral'
                      ? {
                          background:
                            effectiveTheme === 'dark-black'
                              ? '#141820'
                              : effectiveTheme === 'dark'
                                ? '#202938'
                                : '#ffffff',
                          selectionBackground: 'rgba(96, 165, 250, 0.35)',
                          selectionForeground: effectiveTheme === 'light' ? '#0f172a' : '#f9fafb',
                        }
                      : effectiveTheme === 'dark-black'
                        ? {
                            background: '#000000',
                            selectionBackground: 'rgba(96, 165, 250, 0.35)',
                            selectionForeground: '#f9fafb',
                          }
                        : undefined
                }
                contentFilter={
                  provider === 'charm' &&
                  effectiveTheme !== 'dark' &&
                  effectiveTheme !== 'dark-black'
                    ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.05)'
                    : undefined
                }
                initialPrompt={
                  providerMeta[provider]?.initialPromptFlag !== undefined &&
                  !task.metadata?.initialInjectionSent
                    ? (initialInjection ?? undefined)
                    : undefined
                }
                className="h-full w-full"
              />
            </div>
          </div>
        </div>

        <ProviderBar
          provider={provider}
          linearIssue={task.metadata?.linearIssue || null}
          githubIssue={task.metadata?.githubIssue || null}
          jiraIssue={task.metadata?.jiraIssue || null}
          autoApprove={autoApproveEnabled}
          planModeEnabled={planEnabled}
          onPlanModeChange={setPlanEnabled}
          onApprovePlan={async () => {
            try {
              await logPlanEvent(task.path, 'Plan approved via UI; exiting Plan Mode');
            } catch {}
            setPlanEnabled(false);
          }}
        />
      </div>
    </TaskScopeProvider>
  );
};

export default ChatInterface;
