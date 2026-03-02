import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { Plus, X } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import { TerminalPane } from './TerminalPane';
import InstallBanner from './InstallBanner';
import { cn } from '@/lib/utils';
import { agentMeta } from '../providers/meta';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './AgentLogo';
import TaskContextBadges from './TaskContextBadges';
import { Spinner } from './ui/spinner';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { type Agent } from '../types';
import { Task } from '../types/chat';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { activityStore } from '@/lib/activityStore';
import { rpc } from '@/lib/rpc';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';
import { TaskScopeProvider } from './TaskScopeContext';
import { CreateChatModal } from './CreateChatModal';
import { DeleteChatModal } from './DeleteChatModal';
import { type Conversation } from '../../main/services/DatabaseService';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import { getTaskEnvVars } from '@shared/task/envVars';
import { makePtyId } from '@shared/ptyId';
import { generateTaskName } from '../lib/branchNameGenerator';
import { ensureUniqueTaskName } from '../lib/taskNames';
import type { Project } from '../types/app';

declare const window: Window & {
  electronAPI: {
    saveMessage: (message: any) => Promise<{ success: boolean; error?: string }>;
  };
};

interface Props {
  task: Task;
  project?: Project | null;
  projectName: string;
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  projectRemotePath?: string | null;
  defaultBranch?: string | null;
  className?: string;
  initialAgent?: Agent;
  onTaskInterfaceReady?: () => void;
  onRenameTask?: (project: Project, task: Task, newName: string) => Promise<void>;
}

const ChatInterface: React.FC<Props> = ({
  task,
  project,
  projectName: _projectName,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath: _projectRemotePath,
  defaultBranch,
  className,
  initialAgent,
  onTaskInterfaceReady,
  onRenameTask,
}) => {
  const { effectiveTheme } = useTheme();
  const { toast } = useToast();
  const [isAgentInstalled, setIsAgentInstalled] = useState<boolean | null>(null);
  const [agentStatuses, setAgentStatuses] = useState<
    Record<string, { installed?: boolean; path?: string | null; version?: string | null }>
  >({});
  const [agent, setAgent] = useState<Agent>(initialAgent || 'claude');
  const currentAgentStatus = agentStatuses[agent];
  const [cliStartError, setCliStartError] = useState<string | null>(null);

  // Multi-chat state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);
  const [showDeleteChatModal, setShowDeleteChatModal] = useState(false);
  const [chatToDelete, setChatToDelete] = useState<string | null>(null);
  const [busyByConversationId, setBusyByConversationId] = useState<Record<string, boolean>>({});
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);

  const mainConversationId = useMemo(
    () => conversations.find((c) => c.isMain)?.id ?? null,
    [conversations]
  );

  // Update terminal ID to include conversation ID and agent - unique per conversation
  const terminalId = useMemo(() => {
    // Find the active conversation to check if it's the main one
    const activeConversation = conversations.find((c) => c.id === activeConversationId);

    if (activeConversation?.isMain) {
      // Main conversations use task-based ID for backward compatibility
      // This ensures terminal sessions persist correctly
      return makePtyId(agent, 'main', task.id);
    } else if (activeConversationId) {
      // Additional conversations use conversation-specific ID
      return makePtyId(agent, 'chat', activeConversationId);
    }
    // Fallback to main format if no active conversation
    return makePtyId(agent, 'main', task.id);
  }, [activeConversationId, agent, task.id, conversations]);

  // Claude needs consistent working directory to maintain session state
  const terminalCwd = useMemo(() => {
    return task.path;
  }, [task.path]);

  const taskEnv = useMemo(() => {
    if (!projectPath) return undefined;
    return getTaskEnvVars({
      taskId: task.id,
      taskName: task.name,
      taskPath: task.path,
      projectPath,
      defaultBranch: defaultBranch || undefined,
    });
  }, [task.id, task.name, task.path, projectPath, defaultBranch]);

  const installedAgents = useMemo(
    () =>
      Object.entries(agentStatuses)
        .filter(([, status]) => status.installed === true)
        .map(([id]) => id),
    [agentStatuses]
  );
  const sortedConversations = useMemo(
    () =>
      [...conversations].sort((a, b) => {
        // Sort by display order or creation time to maintain consistent order
        if (a.displayOrder !== undefined && b.displayOrder !== undefined) {
          return a.displayOrder - b.displayOrder;
        }
        return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      }),
    [conversations]
  );

  const { activeTerminalId } = useTaskTerminals(task.id, task.path);

  // Line comments for agent context injection
  const { formatted: commentsContext } = useTaskComments(task.id);

  // Auto-scroll to bottom when this task becomes active
  useAutoScrollOnTaskSwitch(true, task.id);

  const readySignaledTaskIdRef = useRef<string | null>(null);
  useEffect(() => {
    const el = tabsContainerRef.current;
    if (!el) return;
    const check = () => setTabsOverflow(el.scrollWidth > el.clientWidth);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [conversations.length]);

  useEffect(() => {
    if (!onTaskInterfaceReady) return;
    if (readySignaledTaskIdRef.current === task.id) return;
    readySignaledTaskIdRef.current = task.id;
    onTaskInterfaceReady();
  }, [task.id, onTaskInterfaceReady]);

  // Load conversations when task changes
  useEffect(() => {
    const loadConversations = async () => {
      setConversationsLoaded(false);
      const loadedConversations = await rpc.db.getConversations(task.id);

      if (loadedConversations.length > 0) {
        setConversations(loadedConversations);

        // Set active conversation
        const active = loadedConversations.find((c: Conversation) => c.isActive);
        if (active) {
          setActiveConversationId(active.id);
          // Update agent to match the active conversation
          if (active.provider) {
            setAgent(active.provider as Agent);
          }
        } else {
          // Fallback to first conversation
          const firstConv = loadedConversations[0];
          setActiveConversationId(firstConv.id);
          // Update agent to match the first conversation
          if (firstConv.provider) {
            setAgent(firstConv.provider as Agent);
          }
          await rpc.db.setActiveConversation({
            taskId: task.id,
            conversationId: firstConv.id,
          });
        }
        setConversationsLoaded(true);
      } else {
        // No conversations exist - create default for backward compatibility
        // This ensures existing tasks always have at least one conversation
        // (preserves pre-multi-chat behavior)
        const defaultConversation = await rpc.db.getOrCreateDefaultConversation(task.id);
        if (defaultConversation) {
          // For backward compatibility: use task.agentId if available, otherwise use current agent
          // This preserves the original agent choice for tasks created before multi-chat
          const taskAgent = task.agentId || agent;
          const conversationWithAgent = {
            ...defaultConversation,
            provider: taskAgent,
            isMain: true,
            isActive: true,
          };
          setConversations([conversationWithAgent]);
          setActiveConversationId(defaultConversation.id);

          // Update the agent state to match
          setAgent(taskAgent as Agent);

          // Save the agent to the conversation
          await rpc.db.saveConversation(conversationWithAgent);
          setConversationsLoaded(true);
        }
      }
    };

    loadConversations();
  }, [task.id, task.agentId]); // provider is intentionally not included as a dependency

  // Activity indicators per conversation tab (main PTY uses `task.id`, chat PTYs use `conversation.id`).
  useEffect(() => {
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const conversationIds = new Set(conversations.map((c) => c.id));

    setBusyByConversationId((prev) => {
      const next: Record<string, boolean> = {};
      for (const id of conversationIds) next[id] = prev[id] ?? false;
      return next;
    });

    if (mainConversationId) {
      unsubs.push(
        activityStore.subscribe(task.id, (busy) => {
          if (cancelled) return;
          setBusyByConversationId((prev) => {
            if (prev[mainConversationId] === busy) return prev;
            return { ...prev, [mainConversationId]: busy };
          });
        })
      );
    }

    for (const conv of conversations) {
      if (conv.isMain) continue;
      const conversationId = conv.id;
      unsubs.push(
        activityStore.subscribe(
          conversationId,
          (busy) => {
            if (cancelled) return;
            setBusyByConversationId((prev) => {
              if (prev[conversationId] === busy) return prev;
              return { ...prev, [conversationId]: busy };
            });
          },
          { kinds: ['chat'] }
        )
      );
    }

    return () => {
      cancelled = true;
      try {
        for (const off of unsubs) off?.();
      } catch {}
    };
  }, [task.id, conversations, mainConversationId]);

  // Ref to control terminal focus imperatively if needed
  const terminalRef = useRef<{ focus: () => void }>(null);

  // Auto-focus terminal when switching to this task
  useEffect(() => {
    if (!conversationsLoaded) return;
    // Small delay to ensure terminal is mounted and attached
    const timer = setTimeout(() => {
      const session = terminalSessionRegistry.getSession(terminalId);
      if (session) {
        session.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [task.id, terminalId, conversationsLoaded]);

  // Focus terminal when this task becomes active (for already-mounted terminals)
  useEffect(() => {
    // Small delay to ensure terminal is visible after tab switch
    const timer = setTimeout(() => {
      terminalRef.current?.focus();
    }, 50);
    return () => clearTimeout(timer);
  }, [task.id]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleWindowFocus = () => {
      timer = setTimeout(() => {
        timer = null;
        if (!mounted) return;
        const session = terminalSessionRegistry.getSession(terminalId);
        if (session) session.focus();
      }, 0);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      mounted = false;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [terminalId]);

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
    setCliStartError(null);
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
          'codex',
          'claude',
          'qwen',
          'droid',
          'gemini',
          'cursor',
          'copilot',
          'amp',
          'opencode',
          'charm',
          'auggie',
          'goose',
          'kimi',
          'kilocode',
          'kiro',
          'rovo',
          'cline',
          'continue',
          'codebuff',
          'mistral',
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

  // Chat management handlers
  const handleCreateChat = useCallback(
    async (title: string, newAgent: string) => {
      try {
        // Don't dispose the current terminal - each chat has its own independent session

        const newConversation = await rpc.db.createConversation({
          taskId: task.id,
          title,
          provider: newAgent,
          isMain: false, // Additional chats are never main
        });

        // Reload conversations from DB
        const dbConversations = await rpc.db.getConversations(task.id);
        const dbIds = new Set(dbConversations.map((c: Conversation) => c.id));
        const missingFromDb = conversations.filter((c) => !dbIds.has(c.id));
        if (missingFromDb.length > 0) {
          // Re-persist conversations that only existed in React state
          for (const missing of missingFromDb) {
            await rpc.db.saveConversation({ ...missing, isActive: false });
          }
          const retryConversations = await rpc.db.getConversations(task.id);
          setConversations(retryConversations);
        } else {
          setConversations(dbConversations);
        }
        setActiveConversationId(newConversation.id);
        setAgent(newAgent as Agent);
        try {
          window.dispatchEvent(
            new CustomEvent('emdash:conversations-changed', { detail: { taskId: task.id } })
          );
        } catch {}
      } catch (error) {
        console.error('Exception creating conversation:', error);
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to create chat',
          variant: 'destructive',
        });
      }
    },
    [task.id, toast, conversations]
  );

  const handleCreateNewChat = useCallback(() => {
    setShowCreateChatModal(true);
  }, []);

  const handleSwitchChat = useCallback(
    async (conversationId: string) => {
      // Don't dispose terminals - just switch between them
      // Each chat maintains its own persistent terminal session

      await rpc.db.setActiveConversation({
        taskId: task.id,
        conversationId,
      });
      setActiveConversationId(conversationId);

      // Update provider based on conversation
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv?.provider) {
        setAgent(conv.provider as Agent);
      }
    },
    [task.id, conversations]
  );

  const handleCloseChat = useCallback(
    (conversationId: string) => {
      if (conversations.length <= 1) {
        toast({
          title: 'Cannot Close',
          description: 'Cannot close the last chat',
          variant: 'destructive',
        });
        return;
      }

      // Show the delete confirmation modal
      setChatToDelete(conversationId);
      setShowDeleteChatModal(true);
    },
    [conversations.length, toast]
  );

  const handleConfirmDeleteChat = useCallback(async () => {
    if (!chatToDelete) return;

    // Only dispose the terminal when actually deleting the chat
    // Find the conversation to get its provider
    const convToDelete = conversations.find((c) => c.id === chatToDelete);
    const convAgent = (convToDelete?.provider || agent) as Agent;
    const terminalToDispose = makePtyId(convAgent, 'chat', chatToDelete);
    terminalSessionRegistry.dispose(terminalToDispose);

    await rpc.db.deleteConversation(chatToDelete);

    // Reload conversations
    const updatedConversations = await rpc.db.getConversations(task.id);
    setConversations(updatedConversations);
    // Switch to another chat if we deleted the active one
    if (chatToDelete === activeConversationId && updatedConversations.length > 0) {
      const newActive = updatedConversations[0];
      await rpc.db.setActiveConversation({
        taskId: task.id,
        conversationId: newActive.id,
      });
      setActiveConversationId(newActive.id);
      // Update provider if needed
      if (newActive.provider) {
        setAgent(newActive.provider as Agent);
      }
    }

    try {
      window.dispatchEvent(
        new CustomEvent('emdash:conversations-changed', { detail: { taskId: task.id } })
      );
    } catch {}

    // Clear the state
    setChatToDelete(null);
    setShowDeleteChatModal(false);
  }, [chatToDelete, conversations, agent, task.id, activeConversationId]);

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
    let refreshCheckRequested = false;
    const api: any = (window as any).electronAPI;

    const applyStatuses = (statuses: Record<string, any> | undefined | null) => {
      if (!statuses) return;
      setAgentStatuses(statuses);
      if (cancelled) return;
      const installed = statuses?.[agent]?.installed === true;
      setIsAgentInstalled(installed);
    };

    const maybeRefreshAgentStatus = async (statuses?: Record<string, any> | undefined | null) => {
      if (cancelled || refreshCheckRequested) return;
      if (!api?.getProviderStatuses) return;

      const status = statuses?.[agent];
      const hasEntry = Boolean(status);
      const isInstalled = status?.installed === true;
      const lastChecked =
        typeof status?.lastChecked === 'number' && Number.isFinite(status.lastChecked)
          ? status.lastChecked
          : 0;
      const isStale = !lastChecked || Date.now() - lastChecked > 5 * 60 * 1000;

      if (hasEntry && isInstalled && !isStale) return;

      refreshCheckRequested = true;
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
          void maybeRefreshAgentStatus(res.statuses);
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
  }, [agent]);

  // Switch active chat/agent via global shortcuts (Cmd+Shift+J/K)
  useEffect(() => {
    const handleAgentSwitch = (event: Event) => {
      const customEvent = event as CustomEvent<{ direction: 'next' | 'prev' }>;
      if (conversations.length <= 1) return;
      const direction = customEvent.detail?.direction;
      if (!direction) return;

      const currentIndex = conversations.findIndex((c) => c.id === activeConversationId);
      if (currentIndex === -1) return;

      let newIndex: number;
      if (direction === 'prev') {
        newIndex = currentIndex <= 0 ? conversations.length - 1 : currentIndex - 1;
      } else {
        newIndex = (currentIndex + 1) % conversations.length;
      }

      const newConversation = conversations[newIndex];
      if (newConversation) {
        handleSwitchChat(newConversation.id);
      }
    };

    window.addEventListener('emdash:switch-agent', handleAgentSwitch);
    return () => {
      window.removeEventListener('emdash:switch-agent', handleAgentSwitch);
    };
  }, [conversations, activeConversationId, handleSwitchChat]);

  // Close active chat tab on Cmd+W
  useEffect(() => {
    const handleCloseActiveChat = () => {
      if (activeConversationId) {
        handleCloseChat(activeConversationId);
      }
    };
    window.addEventListener('emdash:close-active-chat', handleCloseActiveChat);
    return () => window.removeEventListener('emdash:close-active-chat', handleCloseActiveChat);
  }, [activeConversationId, handleCloseChat]);

  const isTerminal = agentMeta[agent]?.terminalOnly === true;
  const autoApproveEnabled =
    Boolean(task.metadata?.autoApprove) && Boolean(agentMeta[agent]?.autoApproveFlag);

  const isMainConversation = activeConversationId === mainConversationId;

  const initialInjection = useMemo(() => {
    if (!isTerminal) return null;
    // Only inject into the main conversation — secondary chats should not
    // receive the task's initial prompt or linked issue context.
    if (!isMainConversation) return null;
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
      const desc = typeof j.description === 'string' ? j.description.trim() : '';
      if (desc) {
        const max = 1500;
        const clipped = desc.length > max ? desc.slice(0, max) + '\n…' : desc;
        lines.push('', 'Issue Description:', clipped);
      }
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
  }, [isTerminal, isMainConversation, task.metadata, commentsContext]);

  // Only use keystroke injection for agents WITHOUT CLI flag support,
  // or agents that explicitly opt into it (useKeystrokeInjection: true).
  // Agents with initialPromptFlag use CLI arg injection via TerminalPane instead.
  useInitialPromptInjection({
    taskId: task.id,
    providerId: agent,
    prompt: initialInjection,
    enabled:
      isTerminal &&
      (agentMeta[agent]?.initialPromptFlag === undefined ||
        agentMeta[agent]?.useKeystrokeInjection === true),
  });

  // Ensure an agent is stored for this task so fallbacks can subscribe immediately
  useEffect(() => {
    try {
      localStorage.setItem(`taskAgent:${task.id}`, agent);
    } catch {}
  }, [agent, task.id]);

  // Auto-rename task from first terminal message (only if name was auto-generated)
  const handleFirstMessage = useCallback(
    (message: string) => {
      if (!project || !onRenameTask) return;
      // Only rename if this task's name was auto-generated
      if (!task.metadata?.nameGenerated) return;
      // Skip multi-agent tasks
      if (task.metadata?.multiAgent?.enabled) return;

      const generated = generateTaskName(message);
      if (!generated) return;

      const existingNames = (project.tasks || []).map((t) => t.name);
      const uniqueName = ensureUniqueTaskName(generated, existingNames);
      void onRenameTask(project, task, uniqueName);
    },
    [project, task, onRenameTask]
  );

  // Whether to enable first-message capture for this task
  const shouldCaptureFirstMessage = !!(
    task.metadata?.nameGenerated &&
    !task.metadata?.multiAgent?.enabled &&
    project &&
    onRenameTask
  );

  if (!isTerminal) {
    return null;
  }

  return (
    <TaskScopeProvider value={{ taskId: task.id, taskPath: task.path }}>
      <div
        className={`flex h-full flex-col ${effectiveTheme === 'dark-black' ? 'bg-black' : 'bg-card'} ${className}`}
      >
        <CreateChatModal
          isOpen={showCreateChatModal}
          onClose={() => setShowCreateChatModal(false)}
          onCreateChat={handleCreateChat}
          installedAgents={installedAgents}
        />

        <DeleteChatModal
          open={showDeleteChatModal}
          onOpenChange={setShowDeleteChatModal}
          onConfirm={handleConfirmDeleteChat}
          onCancel={() => {
            setChatToDelete(null);
            setShowDeleteChatModal(false);
          }}
        />

        <div className="flex min-h-0 flex-1 flex-col">
          <div className="px-6 pt-4">
            <div className="mx-auto max-w-4xl space-y-2">
              <div className="flex items-center gap-2">
                <div
                  ref={tabsContainerRef}
                  className={cn(
                    'flex min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
                    tabsOverflow &&
                      '[mask-image:linear-gradient(to_right,black_calc(100%_-_16px),transparent)]'
                  )}
                >
                  {sortedConversations.map((conv, index) => {
                    const isActive = conv.id === activeConversationId;
                    const convAgent = conv.provider || agent;
                    const config = agentConfig[convAgent as Agent];
                    const agentName = config?.name || convAgent;
                    const isBusy = busyByConversationId[conv.id] === true;

                    // Count how many chats use the same agent up to this point
                    const sameAgentCount = sortedConversations
                      .slice(0, index + 1)
                      .filter((c) => (c.provider || agent) === convAgent).length;
                    const showNumber =
                      sortedConversations.filter((c) => (c.provider || agent) === convAgent)
                        .length > 1;

                    return (
                      <button
                        key={conv.id}
                        onClick={() => handleSwitchChat(conv.id)}
                        aria-current={isActive ? 'page' : undefined}
                        className={cn(
                          'inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors',
                          'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                          isActive
                            ? 'bg-background text-foreground shadow-sm'
                            : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
                        )}
                        title={`${agentName}${showNumber ? ` (${sameAgentCount})` : ''}`}
                      >
                        {config?.logo && (
                          <AgentLogo
                            logo={config.logo}
                            alt={config.alt}
                            isSvg={config.isSvg}
                            invertInDark={config.invertInDark}
                            className="h-3.5 w-3.5 flex-shrink-0"
                          />
                        )}
                        <span className="max-w-[10rem] truncate">
                          {agentName}
                          {showNumber && <span className="ml-1 opacity-60">{sameAgentCount}</span>}
                        </span>
                        {isBusy && conversations.length > 1 ? (
                          <Spinner
                            size="sm"
                            className={cn(
                              'h-3 w-3 flex-shrink-0',
                              isActive ? 'text-foreground' : 'text-muted-foreground'
                            )}
                          />
                        ) : null}
                        {conversations.length > 1 && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCloseChat(conv.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                e.stopPropagation();
                                handleCloseChat(conv.id);
                              }
                            }}
                            className="ml-1 rounded hover:bg-background/20"
                            title="Close chat"
                          >
                            <X className="h-3 w-3" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={handleCreateNewChat}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-muted transition-colors hover:bg-muted/80"
                  title="New Chat"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                  {(task.metadata?.linearIssue ||
                    task.metadata?.githubIssue ||
                    task.metadata?.jiraIssue) && (
                    <TaskContextBadges
                      taskId={task.id}
                      linearIssue={task.metadata?.linearIssue || null}
                      githubIssue={task.metadata?.githubIssue || null}
                      jiraIssue={task.metadata?.jiraIssue || null}
                    />
                  )}
                  {autoApproveEnabled && (
                    <span
                      className="inline-flex h-7 select-none items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 text-xs font-medium text-foreground"
                      title="Auto-approve enabled"
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
                      Auto-approve
                    </span>
                  )}
                </div>
              </div>
              {(() => {
                if (isAgentInstalled === false) {
                  return (
                    <InstallBanner
                      agent={agent as any}
                      terminalId={terminalId}
                      installCommand={getInstallCommandForProvider(agent as any)}
                      onRunInstall={runInstallCommand}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                      mode="missing"
                    />
                  );
                }
                if (cliStartError) {
                  return (
                    <InstallBanner
                      agent={agent as any}
                      terminalId={terminalId}
                      installCommand={null}
                      onRunInstall={runInstallCommand}
                      onOpenExternal={(url) => window.electronAPI.openExternal(url)}
                      mode="start_failed"
                      details={cliStartError}
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
              {/* Wait for conversations to load to ensure stable terminalId */}
              {conversationsLoaded && (
                <TerminalPane
                  ref={terminalRef}
                  id={terminalId}
                  cwd={terminalCwd}
                  remote={
                    projectRemoteConnectionId
                      ? { connectionId: projectRemoteConnectionId }
                      : undefined
                  }
                  providerId={agent}
                  autoApprove={autoApproveEnabled}
                  env={taskEnv}
                  keepAlive={true}
                  mapShiftEnterToCtrlJ
                  disableSnapshots={false}
                  onActivity={() => {
                    try {
                      window.localStorage.setItem(`agent:locked:${task.id}`, agent);
                    } catch {}
                  }}
                  onStartError={(message) => {
                    setCliStartError(message);
                  }}
                  onStartSuccess={() => {
                    setCliStartError(null);
                    // Mark initial injection as sent so it won't re-run on restart
                    if (initialInjection && !task.metadata?.initialInjectionSent) {
                      void rpc.db.saveTask({
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
                    agent === 'charm' &&
                    effectiveTheme !== 'dark' &&
                    effectiveTheme !== 'dark-black'
                      ? 'invert(1) hue-rotate(180deg) brightness(1.1) contrast(1.05)'
                      : undefined
                  }
                  initialPrompt={
                    agentMeta[agent]?.initialPromptFlag !== undefined &&
                    !agentMeta[agent]?.useKeystrokeInjection &&
                    !task.metadata?.initialInjectionSent
                      ? (initialInjection ?? undefined)
                      : undefined
                  }
                  onFirstMessage={shouldCaptureFirstMessage ? handleFirstMessage : undefined}
                  className="h-full w-full"
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </TaskScopeProvider>
  );
};

export default ChatInterface;
