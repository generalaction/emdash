import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useReducedMotion } from 'motion/react';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import { TerminalPane } from './TerminalPane';
import InstallBanner from './InstallBanner';
import { providerMeta } from '../providers/meta';
import ProviderDisplay from './ProviderDisplay';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { type Provider } from '../types';
import { Task } from '../types/chat';
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
  const reduceMotion = useReducedMotion();
  const terminalId = useMemo(() => `${provider}-main-${task.id}`, [provider, task.id]);
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
              <div className="flex items-center justify-between">
                <ProviderDisplay
                  provider={provider}
                  taskId={task.id}
                  linearIssue={task.metadata?.linearIssue || null}
                  githubIssue={task.metadata?.githubIssue || null}
                  jiraIssue={task.metadata?.jiraIssue || null}
                />
                {autoApproveEnabled && (
                  <div className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/50 bg-orange-500/10 px-2 py-1 text-xs font-medium text-orange-700 dark:text-orange-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                    Auto-approve
                  </div>
                )}
              </div>
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
                providerId={provider}
                autoApprove={autoApproveEnabled}
                env={undefined}
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
      </div>
    </TaskScopeProvider>
  );
};

export default ChatInterface;
