import { useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useTaskViewContext } from '../task-view-context';
import { ConversationsTabs } from './tabs';

export function ConversationsPanel() {
  const { params } = useParams('task');
  const { conversations, activeConversationId } = useTaskViewContext();

  const showCreateConversationModal = useShowModal('createConversationModal');

  const activeId = activeConversationId ?? conversations[0]?.id ?? null;
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

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
        <PaneSizingProvider paneId="conversations" sessionIds={allSessionIds}>
          {sessionId && <TerminalPane sessionId={sessionId} className="h-full w-full" />}
        </PaneSizingProvider>
      </div>
    </div>
  );
}
