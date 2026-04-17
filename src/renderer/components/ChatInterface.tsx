import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { PinOff, Plus, X } from 'lucide-react';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import { TerminalPane, type TerminalPaneHandle } from './TerminalPane';
import InstallBanner from './InstallBanner';
import { cn } from '@/lib/utils';
import { agentStatusStore } from '../lib/agentStatusStore';
import { agentMeta } from '../providers/meta';
import { agentConfig } from '../lib/agentConfig';
import AgentLogo from './AgentLogo';
import { TaskStatusIndicator } from './TaskStatusIndicator';
import TaskContextBadges from './TaskContextBadges';
import { useConversationStatus } from '../hooks/useConversationStatus';
import { useStatusUnread } from '../hooks/useStatusUnread';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useCommentInjection } from '../hooks/useCommentInjection';
import { type Agent } from '../types';
import { Task } from '../types/chat';
import { useTaskTerminals } from '@/lib/taskTerminalsStore';
import { activityStore } from '@/lib/activityStore';
import { rpc } from '@/lib/rpc';
import { getInstallCommandForProvider } from '@shared/providers/registry';
import { useAutoScrollOnTaskSwitch } from '@/hooks/useAutoScrollOnTaskSwitch';
import { useTerminalViewportWheelForwarding } from '@/hooks/useTerminalViewportWheelForwarding';
import { TaskScopeProvider } from './TaskScopeContext';
import { CreateChatModal } from './CreateChatModal';
import { type Conversation } from '../../main/services/DatabaseService';
import { terminalSessionRegistry } from '../terminal/SessionRegistry';
import { getTaskEnvVars } from '@shared/task/envVars';
import { makePtyId } from '@shared/ptyId';
import { generateTaskName } from '../lib/branchNameGenerator';
import { ensureUniqueTaskName } from '../lib/taskNames';
import { useAppSettings } from '@/contexts/AppSettingsProvider';
import type { Project } from '../types/app';
import { useWorkspaceConnection } from '../hooks/useWorkspaceConnection';
import { useTerminalSearch } from '../hooks/useTerminalSearch';
import { TerminalSearchOverlay } from './TerminalSearchOverlay';
import { getReviewConversationMetadata, parseConversationMetadata } from '@shared/reviewPreset';
import {
  getConversationTabLabel,
  planConversationTitleUpdates,
} from '../lib/conversationTabTitles';

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

// Cross-panel signal emitted from TaskTerminalPanel when a pinned terminal is selected.
const FOCUS_PINNED_TERMINAL_EVENT = 'emdash:focus-pinned-terminal';

function ConversationTabButton({
  conversation,
  activeConversationId,
  onSwitchChat,
  onCloseChat,
  totalConversationCount,
  fallbackBusy,
  taskId,
}: {
  conversation: Conversation;
  activeConversationId: string | null;
  onSwitchChat: (conversationId: string) => void;
  onCloseChat: (conversationId: string) => void;
  totalConversationCount: number;
  fallbackBusy: boolean;
  taskId: string;
}) {
  const isActive = conversation.id === activeConversationId;
  const convAgent = conversation.provider ?? 'claude';
  const config = agentConfig[convAgent as Agent];
  const tabLabel = getConversationTabLabel(conversation);
  const semanticStatus = useConversationStatus({
    statusId: conversation.isMain ? taskId : conversation.id,
    ptySuffix: conversation.isMain ? taskId : conversation.id,
    ptyKind: conversation.isMain ? 'main' : 'chat',
  });
  const unread = useStatusUnread(conversation.isMain ? taskId : conversation.id);
  const displayStatus = semanticStatus === 'unknown' && fallbackBusy ? 'working' : semanticStatus;

  return (
    <button
      onClick={() => onSwitchChat(conversation.id)}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      )}
      title={tabLabel}
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
      <span className="max-w-[10rem] truncate">{tabLabel}</span>
      {totalConversationCount > 1 ? (
        <TaskStatusIndicator status={displayStatus} unread={unread && !isActive} />
      ) : null}
      {totalConversationCount > 1 && (
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onCloseChat(conversation.id);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onCloseChat(conversation.id);
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
}

function PinnedTerminalTabButton({
  label,
  isActive,
  onClick,
  onUnpin,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
  onUnpin: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'inline-flex h-7 flex-shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium transition-colors',
        'ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
      )}
      title={label}
    >
      <span className="inline-flex w-3.5 flex-shrink-0 justify-center text-[10px] leading-none text-muted-foreground/90">
        {'>_'}
      </span>
      <span className="max-w-[10rem] truncate">{label}</span>
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onUnpin();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            onUnpin();
          }
        }}
        className="ml-1 rounded hover:bg-background/20"
        title="Unpin terminal"
      >
        <PinOff className="h-3 w-3" />
      </span>
    </button>
  );
}

const ChatInterface: React.FC<Props> = ({
  task,
  project,
  projectName: _projectName,
  projectPath,
  projectRemoteConnectionId,
  projectRemotePath,
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

  // Workspace-provisioned remote connection overrides
  const { connectionId: workspaceConnectionId, remotePath: workspaceRemotePath } =
    useWorkspaceConnection(task);

  // Multi-chat state
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [conversationsLoaded, setConversationsLoaded] = useState(false);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);
  const [busyByConversationId, setBusyByConversationId] = useState<Record<string, boolean>>({});
  const [activePinnedTerminalKey, setActivePinnedTerminalKey] = useState<string | null>(null);
  const lockedAgentWriteRef = useRef<string | null>(null);
  const tabsContainerRef = useRef<HTMLDivElement>(null);
  const [tabsOverflow, setTabsOverflow] = useState(false);
  const fallbackAgentRef = useRef<Agent>(initialAgent || 'claude');
  fallbackAgentRef.current = agent;

  const applyStableConversationTitles = useCallback(async (loadedConversations: Conversation[]) => {
    const updates = planConversationTitleUpdates(loadedConversations);
    if (updates.length === 0) return loadedConversations;

    await Promise.all(
      updates.map((update) =>
        rpc.db.updateConversationTitle({
          conversationId: update.id,
          title: update.title,
        })
      )
    );

    const titleById = new Map(updates.map((update) => [update.id, update.title]));
    return loadedConversations.map((conversation) =>
      titleById.has(conversation.id)
        ? { ...conversation, title: titleById.get(conversation.id)! }
        : conversation
    );
  }, []);

  const mainConversationId = useMemo(
    () => conversations.find((c) => c.isMain)?.id ?? null,
    [conversations]
  );
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) ?? null,
    [activeConversationId, conversations]
  );
  const activeReviewMetadata = useMemo(
    () => getReviewConversationMetadata(activeConversation?.metadata),
    [activeConversation?.metadata]
  );

  // Update terminal ID to include conversation ID and agent - unique per conversation
  const terminalId = useMemo(() => {
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
  }, [activeConversation, activeConversationId, agent, task.id]);

  // Claude needs consistent working directory to maintain session state
  const terminalCwd = useMemo(() => {
    return task.path;
  }, [task.path]);

  // Whether this is a workspace-provisioned task (may still be provisioning).
  const isWorkspaceTask = !!task.metadata?.workspace;

  // For workspace tasks, use workspace connection; otherwise use project-level connection
  const effectiveRemote = useMemo(() => {
    if (workspaceConnectionId) {
      return { connectionId: workspaceConnectionId };
    }
    if (projectRemoteConnectionId) {
      return { connectionId: projectRemoteConnectionId };
    }
    return undefined;
  }, [workspaceConnectionId, projectRemoteConnectionId]);

  // For workspace tasks, use the remote worktree path for cd on the remote machine
  const effectiveCwd = useMemo(() => {
    if (workspaceConnectionId && workspaceRemotePath) {
      return workspaceRemotePath;
    }
    return terminalCwd;
  }, [workspaceConnectionId, workspaceRemotePath, terminalCwd]);

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
  const sidebarTaskKey = `${task.id}::${task.path}`;
  const sidebarTaskTerminals = useTaskTerminals(sidebarTaskKey, task.path);
  const sidebarGlobalKey = task.path
    ? `global::${task.path}`
    : projectPath
      ? `global::${projectPath}`
      : 'global::home';
  const sidebarGlobalTerminals = useTaskTerminals(sidebarGlobalKey, projectPath || undefined);
  const pinnedTerminals = useMemo(() => {
    const taskPins = sidebarTaskTerminals.terminals
      .filter((terminal) => terminal.pinned)
      .map((terminal) => ({
        key: `task::${terminal.id}`,
        terminalId: terminal.id,
        tabLabel: `${terminal.title} (worktree)`,
        cwd: terminal.cwd,
        scope: 'task' as const,
      }));
    const globalPins = sidebarGlobalTerminals.terminals
      .filter((terminal) => terminal.pinned)
      .map((terminal) => ({
        key: `global::${terminal.id}`,
        terminalId: terminal.id,
        tabLabel: `${terminal.title} (project)`,
        cwd: terminal.cwd,
        scope: 'global' as const,
      }));
    return [...taskPins, ...globalPins];
  }, [sidebarTaskTerminals.terminals, sidebarGlobalTerminals.terminals]);
  const activePinnedTerminal = useMemo(
    () => pinnedTerminals.find((terminal) => terminal.key === activePinnedTerminalKey) ?? null,
    [pinnedTerminals, activePinnedTerminalKey]
  );
  const effectiveRemoteProjectPath = useMemo(
    () => workspaceRemotePath || projectRemotePath || undefined,
    [workspaceRemotePath, projectRemotePath]
  );
  const activeTerminalPaneId = activePinnedTerminal?.terminalId ?? terminalId;
  const activeTerminalPaneCwd = useMemo(() => {
    if (!activePinnedTerminal) return effectiveCwd;
    if (activePinnedTerminal.scope === 'task') {
      return effectiveRemoteProjectPath || activePinnedTerminal.cwd || task.path;
    }
    return activePinnedTerminal.cwd || projectPath || task.path;
  }, [activePinnedTerminal, effectiveCwd, effectiveRemoteProjectPath, task.path, projectPath]);

  // Wire comment injection to pendingInjectionManager
  useCommentInjection(task.id, task.path);

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

  useEffect(() => {
    if (!activePinnedTerminalKey) return;
    if (pinnedTerminals.some((terminal) => terminal.key === activePinnedTerminalKey)) return;
    setActivePinnedTerminalKey(null);
  }, [activePinnedTerminalKey, pinnedTerminals]);

  const syncConversations = useCallback(async () => {
    setConversationsLoaded(false);
    const loadedConversations = await rpc.db.getConversations(task.id);
    const normalizedConversations = await applyStableConversationTitles(loadedConversations);

    if (normalizedConversations.length > 0) {
      setConversations(normalizedConversations);

      const active =
        normalizedConversations.find((c: Conversation) => c.isActive) ?? normalizedConversations[0];
      setActiveConversationId(active.id);
      if (active.provider) {
        setAgent(active.provider as Agent);
      }

      if (!normalizedConversations.some((c: Conversation) => c.isActive)) {
        await rpc.db.setActiveConversation({
          taskId: task.id,
          conversationId: active.id,
        });
      }

      setConversationsLoaded(true);
      return;
    }

    // No conversations exist - create default for backward compatibility
    // (preserves pre-multi-chat behavior for existing tasks)
    const taskAgent = (task.agentId || fallbackAgentRef.current) as string;
    const defaultConversation = await rpc.db.getOrCreateDefaultConversation({
      taskId: task.id,
      provider: taskAgent,
    });

    const normalizedDefaultConversations = await applyStableConversationTitles([
      {
        ...defaultConversation,
        isMain: true,
        isActive: true,
      },
    ]);
    setConversations(normalizedDefaultConversations);
    setActiveConversationId(defaultConversation.id);
    setAgent((defaultConversation.provider || taskAgent) as Agent);
    setConversationsLoaded(true);
  }, [applyStableConversationTitles, task.id, task.agentId]);

  // Load conversations when task changes
  useEffect(() => {
    void syncConversations();
  }, [syncConversations]);
  useEffect(() => {
    const handleConversationsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId?: string }>).detail;
      if (detail?.taskId !== task.id) return;
      void syncConversations();
    };

    window.addEventListener(
      'emdash:conversations-changed',
      handleConversationsChanged as EventListener
    );
    return () => {
      window.removeEventListener(
        'emdash:conversations-changed',
        handleConversationsChanged as EventListener
      );
    };
  }, [task.id, syncConversations]);

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

  useEffect(() => {
    const activeConversation = conversations.find(
      (conversation) => conversation.id === activeConversationId
    );
    if (!activeConversation) return;
    agentStatusStore.markSeen(activeConversation.isMain ? task.id : activeConversation.id);
  }, [activeConversationId, conversations, task.id]);

  useEffect(() => {
    const activeConversation = conversations.find(
      (conversation) => conversation.id === activeConversationId
    );
    if (!activeConversation) {
      agentStatusStore.setActiveView({ taskId: null, statusId: null });
      return;
    }

    agentStatusStore.setActiveView({
      taskId: task.id,
      statusId: activeConversation.isMain ? task.id : activeConversation.id,
    });

    return () => {
      agentStatusStore.setActiveView({ taskId: null, statusId: null });
    };
  }, [activeConversationId, conversations, task.id]);

  // Ref to control terminal focus and viewport scrolling imperatively.
  const terminalRef = useRef<TerminalPaneHandle>(null);
  const handleTerminalViewportWheelForwarding = useTerminalViewportWheelForwarding(terminalRef);
  const terminalPanelRef = useRef<HTMLDivElement | null>(null);
  const {
    isSearchOpen,
    searchQuery,
    searchStatus,
    searchInputRef,
    closeSearch,
    handleSearchQueryChange,
    stepSearch,
  } = useTerminalSearch({
    terminalId: activeTerminalPaneId,
    containerRef: terminalPanelRef,
    enabled: true,
    onCloseFocus: () => terminalRef.current?.focus(),
  });

  const handleTerminalActivity = useCallback(() => {
    const storageKey = `agent:locked:${task.id}`;
    const writeToken = `${storageKey}:${agent}`;
    if (lockedAgentWriteRef.current === writeToken) return;
    lockedAgentWriteRef.current = writeToken;

    try {
      if (window.localStorage.getItem(storageKey) === agent) return;
      window.localStorage.setItem(storageKey, agent);
    } catch {}
  }, [agent, task.id]);

  // Auto-focus terminal when switching to this task
  useEffect(() => {
    if (!conversationsLoaded) return;
    // Small delay to ensure terminal is mounted and attached
    const timer = setTimeout(() => {
      const session = terminalSessionRegistry.getSession(activeTerminalPaneId);
      if (session) {
        session.focus();
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [task.id, activeTerminalPaneId, conversationsLoaded]);

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
        const session = terminalSessionRegistry.getSession(activeTerminalPaneId);
        if (session) session.focus();
      }, 0);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      mounted = false;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [activeTerminalPaneId]);

  useEffect(() => {
    if (activePinnedTerminal) return;
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
  }, [agent, terminalId, activePinnedTerminal]);

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
          'hermes',
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
    async ({
      title,
      agent: newAgent,
      metadata,
    }: {
      title: string;
      agent: string;
      metadata?: string | null;
    }) => {
      try {
        // Don't dispose the current terminal - each chat has its own independent session

        const newConversation = await rpc.db.createConversation({
          taskId: task.id,
          title,
          provider: newAgent,
          isMain: false, // Additional chats are never main
          metadata,
        });
        setActiveConversationId(newConversation.id);
        setAgent(newAgent as Agent);
        await syncConversations();
        window.dispatchEvent(
          new CustomEvent('emdash:conversations-changed', { detail: { taskId: task.id } })
        );
      } catch (error) {
        console.error('Exception creating conversation:', error);
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to create chat',
          variant: 'destructive',
        });
      }
    },
    [syncConversations, task.id, toast]
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
      setActivePinnedTerminalKey(null);

      // Update provider based on conversation
      const conv = conversations.find((c) => c.id === conversationId);
      if (conv?.provider) {
        setAgent(conv.provider as Agent);
      }
    },
    [task.id, conversations]
  );

  const handleSelectPinnedTerminal = useCallback(
    (terminalKey: string) => {
      const current = pinnedTerminals.find((terminal) => terminal.key === terminalKey);
      if (!current) return;
      if (activePinnedTerminalKey === terminalKey) {
        terminalSessionRegistry.getSession(current.terminalId)?.focus();
        return;
      }
      setActivePinnedTerminalKey(terminalKey);
    },
    [activePinnedTerminalKey, pinnedTerminals]
  );

  const handleUnpinPinnedTerminal = useCallback(
    (terminalKey: string) => {
      const terminal = pinnedTerminals.find((item) => item.key === terminalKey);
      if (!terminal) return;
      if (terminal.scope === 'task') {
        sidebarTaskTerminals.setPinned(terminal.terminalId, false);
      } else {
        sidebarGlobalTerminals.setPinned(terminal.terminalId, false);
      }
      if (activePinnedTerminalKey === terminalKey) {
        setActivePinnedTerminalKey(null);
      }
    },
    [pinnedTerminals, sidebarTaskTerminals, sidebarGlobalTerminals, activePinnedTerminalKey]
  );

  useEffect(() => {
    const onFocusPinned = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          taskId?: string | null;
          scope?: 'task' | 'global';
          terminalId?: string;
        }>
      ).detail;
      if (!detail?.terminalId || !detail.scope) return;
      if (detail.taskId !== task.id) return;
      handleSelectPinnedTerminal(`${detail.scope}::${detail.terminalId}`);
    };

    window.addEventListener(FOCUS_PINNED_TERMINAL_EVENT, onFocusPinned as EventListener);
    return () =>
      window.removeEventListener(FOCUS_PINNED_TERMINAL_EVENT, onFocusPinned as EventListener);
  }, [task.id, handleSelectPinnedTerminal]);

  const handleCloseChat = useCallback(
    async (conversationId: string) => {
      if (conversations.length <= 1) {
        toast({
          title: 'Cannot Close',
          description: 'Cannot close the last chat',
          variant: 'destructive',
        });
        return;
      }

      // Dispose the terminal for this chat
      const convToDelete = conversations.find((c) => c.id === conversationId);
      const convAgent = (convToDelete?.provider ?? 'claude') as Agent;
      const terminalToDispose = makePtyId(convAgent, 'chat', conversationId);
      terminalSessionRegistry.dispose(terminalToDispose);

      await rpc.db.deleteConversation(conversationId);

      // Reload conversations
      const updatedConversations = await applyStableConversationTitles(
        await rpc.db.getConversations(task.id)
      );
      setConversations(updatedConversations);
      // Switch to another chat if we deleted the active one
      if (conversationId === activeConversationId && updatedConversations.length > 0) {
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
    },
    [conversations, task.id, activeConversationId, toast, applyStableConversationTitles]
  );

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
      if (sortedConversations.length <= 1) return;
      const direction = customEvent.detail?.direction;
      if (!direction) return;

      const currentIndex = sortedConversations.findIndex((c) => c.id === activeConversationId);
      if (currentIndex === -1) return;

      let newIndex: number;
      if (direction === 'prev') {
        newIndex = currentIndex <= 0 ? sortedConversations.length - 1 : currentIndex - 1;
      } else {
        newIndex = (currentIndex + 1) % sortedConversations.length;
      }

      const newConversation = sortedConversations[newIndex];
      if (newConversation) {
        handleSwitchChat(newConversation.id);
      }
    };

    window.addEventListener('emdash:switch-agent', handleAgentSwitch);
    return () => {
      window.removeEventListener('emdash:switch-agent', handleAgentSwitch);
    };
  }, [sortedConversations, activeConversationId, handleSwitchChat]);

  useEffect(() => {
    const handleAgentTabSelection = (event: Event) => {
      const customEvent = event as CustomEvent<{ tabIndex: number }>;
      const tabIndex = customEvent.detail?.tabIndex;
      if (typeof tabIndex !== 'number') return;
      if (tabIndex < 0 || tabIndex >= sortedConversations.length) return;

      const selectedConversation = sortedConversations[tabIndex];
      if (selectedConversation) {
        handleSwitchChat(selectedConversation.id);
      }
    };

    window.addEventListener('emdash:select-agent-tab', handleAgentTabSelection);
    return () => {
      window.removeEventListener('emdash:select-agent-tab', handleAgentTabSelection);
    };
  }, [sortedConversations, handleSwitchChat]);

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

  // Auto-approve is enabled if:
  // 1. The task was explicitly created with autoApprove, OR
  // 2. The global "auto-approve by default" setting is on
  // In both cases the provider must actually support an auto-approve flag.
  const { settings: autoApproveSettings } = useAppSettings();
  const autoApproveEnabled =
    (Boolean(task.metadata?.autoApprove) ||
      Boolean(autoApproveSettings?.tasks?.autoApproveByDefault)) &&
    Boolean(agentMeta[agent]?.autoApproveFlag);

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
      return parts.join('\n');
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
      return parts.join('\n');
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
      return lines.join('\n');
    }

    return null;
  }, [isTerminal, isMainConversation, task.metadata]);
  const reviewPrompt = !activeConversation?.isMain
    ? (activeReviewMetadata?.initialPrompt ?? null)
    : null;
  const reviewPromptSent =
    !activeConversation?.isMain && activeReviewMetadata?.initialPromptSent === true;

  // Only use keystroke injection for agents WITHOUT CLI flag support,
  // or agents that explicitly opt into it (useKeystrokeInjection: true).
  // Agents with initialPromptFlag use CLI arg injection via TerminalPane instead.
  useInitialPromptInjection({
    scopeId: task.id,
    providerId: agent,
    prompt: initialInjection,
    enabled:
      isMainConversation &&
      isTerminal &&
      (agentMeta[agent]?.initialPromptFlag === undefined ||
        agentMeta[agent]?.useKeystrokeInjection === true),
  });
  useInitialPromptInjection({
    scopeId: activeConversation?.id ?? '',
    ptyKind: 'chat',
    providerId: agent,
    prompt: reviewPrompt,
    enabled:
      !isMainConversation &&
      isTerminal &&
      !!activeConversation?.id &&
      !reviewPromptSent &&
      (agentMeta[agent]?.initialPromptFlag === undefined ||
        agentMeta[agent]?.useKeystrokeInjection === true),
  });

  // Ensure an agent is stored for this task so fallbacks can subscribe immediately
  useEffect(() => {
    try {
      localStorage.setItem(`taskAgent:${task.id}`, agent);
    } catch {}
  }, [agent, task.id]);

  // Auto-rename task from first terminal message (only if name was auto-generated
  // and the auto-infer setting is enabled)
  const { settings: appSettings } = useAppSettings();
  const autoInferTaskNames = appSettings?.tasks?.autoInferTaskNames ?? false;

  const handleFirstMessage = useCallback(
    (message: string) => {
      if (!project || !onRenameTask) return;
      // Only rename if this task's name was auto-generated
      if (!task.metadata?.nameGenerated) return;
      // Only rename if auto-infer is enabled
      if (!autoInferTaskNames) return;
      // Skip multi-agent tasks
      if (task.metadata?.multiAgent?.enabled) return;

      const generated = generateTaskName(message);
      if (!generated) return;

      const existingNames = (project.tasks || []).map((t) => t.name);
      const uniqueName = ensureUniqueTaskName(generated, existingNames);
      void onRenameTask(project, task, uniqueName);
    },
    [project, task, onRenameTask, autoInferTaskNames]
  );

  // Whether to enable first-message capture for this task
  const shouldCaptureFirstMessage = !!(
    autoInferTaskNames &&
    task.metadata?.nameGenerated &&
    !task.metadata?.multiAgent?.enabled &&
    project &&
    onRenameTask
  );

  const markActiveReviewPromptSent = useCallback(() => {
    if (!activeConversation || activeConversation.isMain || !activeReviewMetadata) return;
    if (activeReviewMetadata.initialPromptSent) return;

    const nextMetadata = JSON.stringify({
      ...(parseConversationMetadata(activeConversation.metadata) ?? {}),
      mode: 'review',
      initialPrompt: activeReviewMetadata.initialPrompt,
      initialPromptSent: true,
    });

    setConversations((prev) =>
      prev.map((conversation) =>
        conversation.id === activeConversation.id
          ? { ...conversation, metadata: nextMetadata }
          : conversation
      )
    );

    void rpc.db.saveConversation({
      ...activeConversation,
      metadata: nextMetadata,
    });
  }, [activeConversation, activeReviewMetadata]);

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
                  {sortedConversations.map((conv) => {
                    const isBusy = busyByConversationId[conv.id] === true;

                    return (
                      <ConversationTabButton
                        key={conv.id}
                        conversation={conv}
                        activeConversationId={activePinnedTerminal ? null : activeConversationId}
                        onSwitchChat={handleSwitchChat}
                        onCloseChat={handleCloseChat}
                        totalConversationCount={conversations.length}
                        fallbackBusy={isBusy}
                        taskId={task.id}
                      />
                    );
                  })}
                  {pinnedTerminals.map((terminal) => (
                    <PinnedTerminalTabButton
                      key={terminal.key}
                      label={terminal.tabLabel}
                      isActive={activePinnedTerminal?.key === terminal.key}
                      onClick={() => handleSelectPinnedTerminal(terminal.key)}
                      onUnpin={() => handleUnpinPinnedTerminal(terminal.key)}
                    />
                  ))}
                </div>
                <button
                  onClick={handleCreateNewChat}
                  className="inline-flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-muted transition-colors hover:bg-muted/80"
                  title="New Chat"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
                <div className="ml-auto flex flex-shrink-0 items-center gap-2">
                  <TaskContextBadges
                    taskId={task.id}
                    linearIssue={task.metadata?.linearIssue || null}
                    githubIssue={task.metadata?.githubIssue || null}
                    jiraIssue={task.metadata?.jiraIssue || null}
                  />
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
              {!activePinnedTerminal &&
                (() => {
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
          <div
            className="mt-4 min-h-0 flex-1 px-6"
            onWheelCapture={handleTerminalViewportWheelForwarding}
          >
            <div
              ref={terminalPanelRef}
              className={`relative mx-auto h-full max-w-4xl overflow-hidden rounded-md ${
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
              <TerminalSearchOverlay
                isOpen={isSearchOpen}
                fullWidth
                searchQuery={searchQuery}
                searchStatus={searchStatus}
                searchInputRef={searchInputRef}
                onQueryChange={handleSearchQueryChange}
                onStep={stepSearch}
                onClose={closeSearch}
              />
              {/* Wait for conversations to load to ensure stable terminalId.
                  For workspace tasks, also wait until the workspace connection is
                  resolved so the PTY starts on the remote host, not locally. */}
              {conversationsLoaded && (!isWorkspaceTask || workspaceConnectionId) && (
                <TerminalPane
                  ref={terminalRef}
                  id={activeTerminalPaneId}
                  cwd={activeTerminalPaneCwd}
                  remote={effectiveRemote}
                  providerId={activePinnedTerminal ? undefined : agent}
                  autoApprove={activePinnedTerminal ? undefined : autoApproveEnabled}
                  env={activePinnedTerminal ? undefined : taskEnv}
                  keepAlive={true}
                  mapShiftEnterToCtrlJ
                  disableSnapshots={false}
                  onActivity={activePinnedTerminal ? undefined : handleTerminalActivity}
                  onStartError={
                    activePinnedTerminal
                      ? undefined
                      : (message) => {
                          setCliStartError(message);
                        }
                  }
                  onStartSuccess={() => {
                    if (activePinnedTerminal) return;
                    setCliStartError(null);
                    if (
                      isMainConversation &&
                      initialInjection &&
                      !task.metadata?.initialInjectionSent
                    ) {
                      void rpc.db.saveTask({
                        ...task,
                        metadata: {
                          ...task.metadata,
                          initialInjectionSent: true,
                        },
                      });
                    }
                    if (!isMainConversation && reviewPrompt && !reviewPromptSent) {
                      markActiveReviewPromptSent();
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
                    !activePinnedTerminal &&
                    agentMeta[agent]?.initialPromptFlag !== undefined &&
                    !agentMeta[agent]?.useKeystrokeInjection &&
                    ((isMainConversation && !task.metadata?.initialInjectionSent) ||
                      (!isMainConversation && !reviewPromptSent))
                      ? isMainConversation
                        ? (initialInjection ?? undefined)
                        : (reviewPrompt ?? undefined)
                      : undefined
                  }
                  onFirstMessage={
                    activePinnedTerminal
                      ? undefined
                      : shouldCaptureFirstMessage
                        ? handleFirstMessage
                        : undefined
                  }
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
