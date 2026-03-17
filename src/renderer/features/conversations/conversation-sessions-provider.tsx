import { createContext, useCallback, useContext, useRef, type ReactNode } from 'react';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { rpc } from '@renderer/core/ipc';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { terminalPool } from '@renderer/core/pty/pty-pool';

interface ConversationSessionsContextValue {
  /**
   * Register a FrontendPty listener and tell the main process to start the PTY.
   *
   * Fully idempotent: subsequent calls for the same session are no-ops, so
   * callers (hover handlers, panel mounts, etc.) never need to track whether
   * a session has already been started.
   *
   * @param initialSize  Terminal cols/rows to pass to the main process.  Pass
   *   this when the pane container is already in the DOM so the PTY starts at
   *   the correct width.  Omit for hover pre-warm — PaneSizingProvider will
   *   resize the PTY when the pane renders.
   */
  startSession: (
    conv: Conversation,
    projectId: string,
    taskId: string,
    initialSize?: { cols: number; rows: number }
  ) => void;
  /**
   * Dispose the FrontendPty and xterm Terminal for a deleted conversation.
   * Resets the idempotency guard so the session could be re-started if needed.
   */
  removeSession: (projectId: string, taskId: string, conversationId: string) => void;
}

const ConversationSessionsContext = createContext<ConversationSessionsContextValue | null>(null);

export function ConversationSessionsProvider({ children }: { children: ReactNode }) {
  // Tracks session IDs for which rpc.conversations.startSession has been called.
  // Kept outside React state because it only needs to guard side-effects, not
  // trigger re-renders.
  const startedRef = useRef<Set<string>>(new Set());

  const startSession = useCallback(
    (
      conv: Conversation,
      projectId: string,
      taskId: string,
      initialSize?: { cols: number; rows: number }
    ) => {
      const sessionId = makePtySessionId(projectId, taskId, conv.id);
      if (startedRef.current.has(sessionId)) return;

      // Register the IPC listener BEFORE the RPC call so the renderer never
      // misses the first data chunk from the main process.
      frontendPtyRegistry.register(sessionId);
      rpc.conversations.startSession(conv, false, initialSize).catch(() => {});
      startedRef.current.add(sessionId);
    },
    []
  );

  const removeSession = useCallback((projectId: string, taskId: string, conversationId: string) => {
    const sessionId = makePtySessionId(projectId, taskId, conversationId);
    frontendPtyRegistry.unregister(sessionId);
    terminalPool.dispose(sessionId);
    startedRef.current.delete(sessionId);
  }, []);

  return (
    <ConversationSessionsContext.Provider value={{ startSession, removeSession }}>
      {children}
    </ConversationSessionsContext.Provider>
  );
}

export function useConversationSessions(): ConversationSessionsContextValue {
  const ctx = useContext(ConversationSessionsContext);
  if (!ctx) {
    throw new Error('useConversationSessions must be used within a ConversationSessionsProvider');
  }
  return ctx;
}
