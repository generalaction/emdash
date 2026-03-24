import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { PaneSizingProvider } from '@renderer/core/pty/pane-sizing-context';
import { frontendPtyRegistry } from '@renderer/core/pty/pty';
import { TerminalPane } from '@renderer/core/pty/pty-pane';
import { useParams } from '@renderer/core/view/navigation-provider';
import { useTaskViewContext } from '../task-view-context';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { params } = useParams('task');
  const { conversations, activeConversationId, setActiveConversationId } = useTaskViewContext();

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
      <EmptyState
        icon={<MessageSquare className="h-5 w-5 text-muted-foreground" />}
        label="No conversations yet"
        description="Create one to open a terminal session for this task and work with an agent."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              showCreateConversationModal({
                projectId: params.projectId,
                taskId: params.taskId,
                onSuccess: ({ conversationId }) => setActiveConversationId(conversationId),
              })
            }
          >
            Create conversation
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0">
        <ConversationsTabs projectId={params.projectId} taskId={params.taskId} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <PaneSizingProvider paneId="conversations" sessionIds={allSessionIds}>
          {sessionId && frontendPtyRegistry.isReady(sessionId) && (
            <TerminalPane sessionId={sessionId} className="h-full w-full" />
          )}
        </PaneSizingProvider>
      </div>
    </div>
  );
});
