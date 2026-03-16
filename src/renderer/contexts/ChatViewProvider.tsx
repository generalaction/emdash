import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ptyStartedChannel } from '@shared/events/appEvents';
import { makePtyId } from '@shared/ptyId';
// SessionRegistry removed — session lifecycle is now managed in the main process.
import { useAutoScrollOnTaskSwitch } from '@renderer/hooks/useAutoScrollOnTaskSwitch';
import { useConversations } from '../_deprecated/ConversationsProvider';
import { events } from '../core/ipc';
import { useInitialPromptInjection } from '../hooks/useInitialPromptInjection';
import { useTaskComments } from '../hooks/useLineComments';
import { useTaskInitialInjection } from '../hooks/useTaskInitialInjection';
import { useTheme } from '../hooks/useTheme';
import { generateTaskName } from '../lib/branchNameGenerator';
import { ensureUniqueTaskName } from '../lib/taskNames';
import { agentMeta } from '../providers/meta';
import { type Agent } from '../types';
import type { Project } from '../types/app';
import { Task } from '../types/chat';

interface ChatViewProviderProps {
  task: Task;
  project?: Project | null;
  /** @deprecated env is built in the main process; kept for future use */
  projectPath?: string | null;
  projectRemoteConnectionId?: string | null;
  /** @deprecated kept for API compatibility */
  defaultBranch?: string | null;
  initialAgent?: Agent;
  onTaskInterfaceReady?: () => void;
  onRenameTask?: (project: Project, task: Task, newName: string) => Promise<void>;
  children: React.ReactNode;
}

type ChatViewContextValue = {
  task: Task;
  project: Project | null | undefined;
  agent: Agent;
  effectiveTheme: 'light' | 'dark' | 'dark-black';
  isTerminal: boolean;
  conversationId: string;
  terminalId: string;
  terminalCwd: string | null;
  cliStartError: string | null;
  showCreateChatModal: boolean;
  autoApproveEnabled: boolean;
  isMainConversation: boolean;
  initialInjection: string | null;
  shouldCaptureFirstMessage: boolean;
  projectRemoteConnectionId: string | null | undefined;
  terminalRef: React.RefObject<{ focus: () => void }>;
  handleCreateNewChat: () => void;
  handleFirstMessage: (msg: string) => void;
  setShowCreateChatModal: (v: boolean) => void;
  setCliStartError: (v: string | null) => void;
};

const ChatViewContext = createContext<ChatViewContextValue | null>(null);

function useTerminalFocus(terminalId: string, taskId: string) {
  // Focus is now managed via the useTerminal hook's returned `focus()` function in TerminalPane.
  // These hooks retain the window-focus listener for future use.
  useEffect(() => {
    void terminalId; // referenced to satisfy exhaustive-deps
  }, [taskId, terminalId]);

  useEffect(() => {
    let mounted = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const handleWindowFocus = () => {
      timer = setTimeout(() => {
        timer = null;
        if (!mounted) return;
        // Focus is delegated to the TerminalPane component's ref.
      }, 0);
    };
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      mounted = false;
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [terminalId]);
}

export function ChatViewProvider({
  task,
  project,
  projectPath: _projectPath,
  projectRemoteConnectionId,
  defaultBranch: _defaultBranch,
  initialAgent,
  onTaskInterfaceReady,
  onRenameTask,
  children,
}: ChatViewProviderProps) {
  const { effectiveTheme } = useTheme();

  const [agent, setAgent] = useState<Agent>(initialAgent ?? 'claude');
  const [cliStartError, setCliStartError] = useState<string | null>(null);
  const [showCreateChatModal, setShowCreateChatModal] = useState(false);

  const { conversations, activeConversationId, activeConversation, mainConversationId } =
    useConversations();

  // Derive the active conversation ID for PTY session identity
  const conversationId = useMemo(
    () => activeConversationId ?? conversations[0]?.id ?? '',
    [activeConversationId, conversations]
  );

  const terminalId = useMemo(
    () => (conversationId ? makePtyId(agent, conversationId) : ''),
    [conversationId, agent]
  );

  const terminalCwd = useMemo(() => task.path, [task.path]);

  const { formatted: commentsContext } = useTaskComments(task.id);
  useAutoScrollOnTaskSwitch(true, task.id);

  const terminalRef = useRef<{ focus: () => void }>(null);
  const readySignaledTaskIdRef = useRef<string | null>(null);

  // Signal readiness once per task
  useEffect(() => {
    if (!onTaskInterfaceReady) return;
    if (readySignaledTaskIdRef.current === task.id) return;
    readySignaledTaskIdRef.current = task.id;
    onTaskInterfaceReady();
  }, [task.id, onTaskInterfaceReady]);

  // Sync agent from the active conversation's stored provider; default to 'claude'
  useEffect(() => {
    if (activeConversation?.provider) {
      setAgent(activeConversation.provider as Agent);
    } else {
      setAgent(initialAgent ?? 'claude');
    }
  }, [activeConversation?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clear CLI start error on task change
  useEffect(() => {
    setCliStartError(null);
  }, [task.id]);

  // Track agent switching via telemetry
  const prevAgentRef = useRef<Agent | null>(null);
  useEffect(() => {
    if (prevAgentRef.current && prevAgentRef.current !== agent) {
      void (async () => {
        const { captureTelemetry } = await import('../lib/telemetryClient');
        captureTelemetry('task_agent_switched', { agent });
      })();
    }
    prevAgentRef.current = agent;
  }, [agent]);

  // Auto-send start command for terminalOnly agents
  useEffect(() => {
    const meta = agentMeta[agent];
    if (!meta?.terminalOnly || !meta.autoStartCommand) return;

    const onceKey = `cli:autoStart:${terminalId}`;
    try {
      if (localStorage.getItem(onceKey) === '1') return;
    } catch {}

    const send = () => {
      try {
        window.electronAPI.ptyInput({ id: terminalId, data: `${meta.autoStartCommand}\n` });
        try {
          localStorage.setItem(onceKey, '1');
        } catch {}
      } catch {}
    };

    let off: (() => void) | null = null;
    try {
      off = events.on(ptyStartedChannel, (info) => {
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

  useTerminalFocus(terminalId, task.id);

  const isTerminal = agentMeta[agent]?.terminalOnly === true;
  const autoApproveEnabled =
    Boolean(task.metadata?.autoApprove) && Boolean(agentMeta[agent]?.autoApproveFlag);
  const isMainConversation = activeConversationId === mainConversationId;

  const initialInjection = useTaskInitialInjection({
    metadata: task.metadata,
    isTerminal,
    isMainConversation,
    commentsContext,
  });

  useInitialPromptInjection({
    projectId: project?.id ?? '',
    taskId: task.id,
    conversationId: activeConversationId ?? '',
    providerId: agent,
    prompt: initialInjection,
    enabled:
      !!activeConversationId &&
      !!project?.id &&
      isTerminal &&
      (agentMeta[agent]?.initialPromptFlag === undefined ||
        agentMeta[agent]?.useKeystrokeInjection === true),
  });

  const shouldCaptureFirstMessage = !!(
    task.metadata?.nameGenerated &&
    !task.metadata?.multiAgent?.enabled &&
    project &&
    onRenameTask
  );

  const handleCreateNewChat = useCallback(() => {
    setShowCreateChatModal(true);
  }, []);

  const handleFirstMessage = useCallback(
    (message: string) => {
      if (!project || !onRenameTask) return;
      if (!task.metadata?.nameGenerated) return;
      if (task.metadata?.multiAgent?.enabled) return;

      const generated = generateTaskName(message);
      if (!generated) return;

      const existingNames = (project.tasks || []).map((t) => t.name);
      const uniqueName = ensureUniqueTaskName(generated, existingNames);
      void onRenameTask(project, task, uniqueName);
    },
    [project, task, onRenameTask]
  );

  return (
    <ChatViewContext.Provider
      value={{
        task,
        project,
        agent,
        effectiveTheme,
        isTerminal,
        conversationId,
        terminalId,
        terminalCwd,
        cliStartError,
        showCreateChatModal,
        autoApproveEnabled,
        isMainConversation,
        initialInjection,
        shouldCaptureFirstMessage,
        projectRemoteConnectionId,
        terminalRef,
        handleCreateNewChat,
        handleFirstMessage,
        setShowCreateChatModal,
        setCliStartError,
      }}
    >
      {children}
    </ChatViewContext.Provider>
  );
}

export function useChatView(): ChatViewContextValue {
  const ctx = useContext(ChatViewContext);
  if (!ctx) throw new Error('useChatView must be used within ChatViewProvider');
  return ctx;
}

export type { ChatViewProviderProps };
