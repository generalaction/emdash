import { useEffect, useMemo } from 'react';
import type { Conversation } from '@shared/conversations';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import {
  PaneSizingProvider,
  usePaneSizingContext,
} from '@renderer/core/terminals/pane-sizing-context';
import { TerminalPane } from '@renderer/core/terminals/terminal-pane';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useConversationsContext } from '@renderer/features/conversations/conversation-data-provider';
import { useTaskViewContext } from '../task-view-wrapper';
import { ConversationsTabs } from './tabs';

/**
 * Starts PTY sessions for all conversations in the pane.  startSession is
 * idempotent — safe to call for already-live sessions.  Lives inside
 * PaneSizingProvider so it can read the current pane dimensions to pass as
 * initialSize, avoiding a race where the PTY starts at the default 80×24.
 */
function ConversationSessionStarter({ conversations }: { conversations: Conversation[] }) {
  const paneSizing = usePaneSizingContext();

  const conversationIds = conversations.map((c) => c.id).join(',');

  useEffect(() => {
    // Prefer a direct DOM measurement using a typical monospace cell size
    // (13px font → ~8×16px per cell).  This gives an accurate initialSize
    // even on first mount before any terminal has reported its dimensions.
    // Fall back to the last reported dimensions, then undefined (lets the
    // backend use its default of 80×24 which the terminal will correct via
    // the resize event fired immediately after mount).
    const initialSize =
      paneSizing?.measureCurrentDimensions(8, 16) ??
      paneSizing?.getCurrentDimensions() ??
      undefined;
    for (const conv of conversations) {
      rpc.conversations.startSession(conv, false, initialSize).catch(() => {});
    }
  }, [conversationIds]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

export function ConversationsPanel() {
  const { params } = useParams('task');
  const { conversationsByTaskId } = useConversationsContext();
  const { activeConversationId } = useTaskViewContext();

  const conversations = useMemo(
    () => conversationsByTaskId[params.taskId] ?? [],
    [conversationsByTaskId, params.taskId]
  );

  const showCreateConversationModal = useShowModal('createConversationModal');

  const activeId = activeConversationId ?? conversations[0]?.id ?? null;
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  // All session IDs in this pane (active + background).  PaneSizingProvider
  // uses this list to broadcast PTY resizes to every conversation, ensuring
  // background agents always have the correct terminal width.
  // Memoized to avoid re-running PaneSizingProvider's sessionIds effect on
  // every render when the conversations list hasn't actually changed.
  const allSessionIds = useMemo(
    () => conversations.map((c) => makePtySessionId(params.projectId, params.taskId, c.id)) ?? [],
    [conversations, params.projectId, params.taskId]
  );

  const sessionId = activeConversation
    ? makePtySessionId(params.projectId, params.taskId, activeConversation.id)
    : null;

  if (conversations.length === 0) {
    return (
      <div>
        No conversations found{' '}
        <Button
          onClick={() =>
            showCreateConversationModal({ projectId: params.projectId, taskId: params.taskId })
          }
        >
          Create Conversation
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">
        <ConversationsTabs projectId={params.projectId} taskId={params.taskId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {/* PaneSizingProvider wraps only the terminal area so its container div
            has exactly the terminal's available pixel dimensions.  The paneId
            registers this pane in the module-level registry for external access
            (e.g. hover pre-warm, cross-pane dimension lookup). */}
        <PaneSizingProvider paneId="conversations" sessionIds={allSessionIds}>
          <ConversationSessionStarter conversations={conversations} />
          {sessionId && <TerminalPane sessionId={sessionId} className="h-full w-full" />}
        </PaneSizingProvider>
      </div>
    </div>
  );
}
