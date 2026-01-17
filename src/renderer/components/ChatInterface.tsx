import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useReducedMotion } from 'motion/react';
import { useTheme } from '../hooks/useTheme';
import { TerminalPane } from './TerminalPane';
import InstallBanner from './InstallBanner';
import { agentMeta } from '../providers/meta';
import AgentDisplay from './AgentDisplay';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { type Agent } from '../types';
import { Task } from '../types/chat';
import { useBrowser } from '@/providers/BrowserProvider';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';
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
  initialAgent?: Agent;
}

const ChatInterface: React.FC<Props> = ({
  task,
  projectName: _projectName,
  className,
  initialAgent,
}) => {
  const { effectiveTheme } = useTheme();
  const [isAgentInstalled, setIsAgentInstalled] = useState<boolean | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, { installed?: boolean; path?: string | null; version?: string | null }>
  >({});
  const [agent, setAgent] = useState<Agent>(initialAgent || 'codex');
  const currentAgentStatus = agentStatuses[agent];
  const browser = useBrowser();
  const [cliStartFailed, setCliStartFailed] = useState(false);
  const reduceMotion = useReducedMotion();
  const terminalId = useMemo(() => `${agent}-main-${task.id}`, [agent, task.id]);
  const { activeTerminalId } = useTaskTerminals(task.id, task.path);

  // Line comments for agent context injection
  const { formatted: commentsContext } = useTaskComments(task.id);

  // Auto-scroll to bottom when this task becomes active
  useAutoScrollOnTaskSwitch(true, task.id);

  // Ref to control terminal focus imperatively if needed
  const terminalRef = useRef<{ focus: () => void }>(null);

  // Focus terminal when this task becomes active (for already-mounted terminals)
  useEffect(() => {
    // Small delay to ensure terminal is visible after tab switch
    const timer = setTimeout(() => {
      terminalRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [task.id]);

  useEffect(() => {
    const meta = agentMeta[agent];
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
  }, [agent, terminalId]);

  useEffect(() => {
    setCliStartFailed(false);
    setIsAgentInstalled(null);
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

  // On task change, restore last-selected agent (including Droid).
  // If a locked agent exists (including Droid), prefer locked.
  useEffect(() => {
    try {
      const lastKey = `agent:last:${task.id}`;
      const last = window.localStorage.getItem(lastKey) as Agent | null;

      if (initialAgent) {
        setAgent(initialAgent);
      } else {
        const validAgents: Agent[] = [
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
        if (last && (validAgents as string[]).includes(last)) {
          setAgent(last as Agent);
        } else {
          setAgent('codex');
        }
      }
    } catch {
      setAgent(initialAgent || 'codex');
    }
  }, [task.id, initialAgent]);

  // Persist last-selected agent per task (including Droid)
  useEffect(() => {
    try {
      window.localStorage.setItem(`agent:last:${task.id}`, agent);
    } catch {}
  }, [agent, task.id]);

  // Track agent switching
  const prevAgentRef = React.useRef<Agent | null>(null);
  useEffect(() => {
    if (prevAgentRef.current && prevAgentRef.current !== agent) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_agent_switched', { agent });
      })();
    }
    prevAgentRef.current = agent;
  }, [agent]);

  useEffect(() => {
    const installed = currentAgentStatus?.installed === true;
    setIsAgentInstalled(installed);
  }, [agent, currentAgentStatus]);

  useEffect(() => {
    let cancelled = false;
    let missingCheckRequested = false;
    const api: any = (window as any).electronAPI;

    const applyStatuses = (statuses: Record<string, any> | undefined | null) => {
      if (!statuses) return;
      setAgentStatuses(statuses);
      if (cancelled) return;
      const installed = statuses?.[agent]?.installed === true;
      setIsAgentInstalled(installed);
    };

    const maybeRefreshMissing = async (statuses?: Record<string, any> | undefined | null) => {
      if (cancelled || missingCheckRequested) return;
      if (!api?.getProviderStatuses) return;
      if (statuses && statuses[agent]) return;
      missingCheckRequested = true;
      try {
        const refreshed = await api.getProviderStatuses({ refresh: true, providers: [agent] });
        if (cancelled) return;
        if (refreshed?.success) {
          applyStatuses(refreshed.statuses ?? {});
        }
      } catch (error) {
        console.error('Agent status refresh failed', error);
      }
    };

    const load = async () => {
      if (!api?.getProviderStatuses) {
        setIsAgentInstalled(false);
        return;
      }
      try {
        const res = await api.getProviderStatuses();
        if (cancelled) return;
        if (res?.success) {
          applyStatuses(res.statuses ?? {});
          void maybeRefreshMissing(res.statuses);
        } else {
          setIsAgentInstalled(false);
        }
      } catch (error) {
        if (!cancelled) setIsAgentInstalled(false);
        console.error('Agent status load failed', error);
      }
    };

    const off =
      api?.onProviderStatusUpdated?.((payload: { providerId: string; status: any }) => {
        if (!payload?.providerId) return;
        setAgentStatuses((prev) => {
          const next = { ...prev, [payload.providerId]: payload.status };
          return next;
        });
        if (payload.providerId === agent) {
          setIsAgentInstalled(payload.status?.installed === true);
        }
      }) || null;

    void load();

    return () => {
      cancelled = true;
      off?.();
    };
  }, [agent, task.id]);

  // If we don't even have a cached status entry for the current agent, pessimistically
  // show the install banner and kick off a background refresh to populate it.
  useEffect(() => {
    const api: any = (window as any).electronAPI;
    if (!api?.getProviderStatuses) {
      setIsAgentInstalled(false);
      return;
    }
    if (currentAgentStatus) {
      return;
    }

    let cancelled = false;
    setIsAgentInstalled(false);

    (async () => {
      try {
        const res = await api.getProviderStatuses({ refresh: true, providers: [agent] });
        if (cancelled) return;
        if (res?.success) {
          const statuses = res.statuses ?? {};
          setAgentStatuses(statuses);
          const installed = statuses?.[agent]?.installed === true;
          setIsAgentInstalled(installed);
        }
      } catch (error) {
        if (!cancelled) {
          setIsAgentInstalled(false);
        }
        console.error('Agent status refresh (missing entry) failed', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent, currentAgentStatus]);

  // When switching agents, ensure other streams are stopped
  useEffect(() => {
    (async () => {
      try {
      } catch {}
    })();
  }, [agent, task.id]);

  const isTerminal = agentMeta[agent]?.terminalOnly === true;
  const autoApproveEnabled =
    Boolean(task.metadata?.autoApprove) && Boolean(agentMeta[agent]?.autoApproveFlag);

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

  // Only use keystroke injection for agents WITHOUT CLI flag support
  // Agents with initialPromptFlag use CLI arg injection via TerminalPane instead
  useInitialPromptInjection({
    taskId: task.id,
    providerId: agent,
    prompt: initialInjection,
    enabled: isTerminal && agentMeta[agent]?.initialPromptFlag === undefined,
  });

  // Ensure an agent is stored for this task so fallbacks can subscribe immediately
  useEffect(() => {
    try {
      localStorage.setItem(`taskAgent:${task.id}`, agent);
    } catch {}
  }, [agent, task.id]);

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
                <AgentDisplay
                  agent={agent}
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
                if (isAgentInstalled !== true) {
                  return (
                    <InstallBanner
                      agent={agent as any}
                      terminalId={terminalId}
                      installCommand={getInstallCommandForProvider(agent as any)}
                      onRunInstall={runInstallCommand}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                    />
                  );
                }
                if (cliStartFailed) {
                  return (
                    <InstallBanner
                      agent={agent as any}
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
                agent === 'charm'
                  ? effectiveTheme === 'dark-black'
                    ? 'bg-black'
                    : effectiveTheme === 'dark'
                      ? 'bg-card'
                      : 'bg-white'
                  : agent === 'mistral'
                    ? effectiveTheme === 'dark' || effectiveTheme === 'dark-black'
                      ? effectiveTheme === 'dark-black'
                        ? 'bg-[#141820]'
                        : 'bg-[#202938]'
                      : 'bg-white'
                    : ''
              }`}
            >
              <TerminalPane
                ref={terminalRef}
                id={terminalId}
                cwd={task.path}
                shell={agentMeta[agent].cli}
                autoApprove={autoApproveEnabled}
                env={undefined}
                keepAlive={true}
                onActivity={() => {
                  try {
                    window.localStorage.setItem(`agent:locked:${task.id}`, agent);
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
                  agent === 'charm'
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
                    : agent === 'mistral'
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
                  agent === 'charm' && effectiveTheme !== 'dark' && effectiveTheme !== 'dark-black'
                    ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.05)'
                    : undefined
                }
                initialPrompt={
                  agentMeta[agent]?.initialPromptFlag !== undefined &&
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
