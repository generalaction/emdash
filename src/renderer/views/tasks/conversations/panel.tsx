import { MessageSquare } from 'lucide-react';
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
      <div className="flex h-full min-h-0 w-full flex-col items-center justify-center p-6">
        <div className="flex max-w-sm flex-col items-center text-center">
          <div
            className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-full border border-dashed border-border/60 bg-muted/30"
            aria-hidden
          >
            <MessageSquare className="h-5 w-5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-semibold text-foreground">No conversations yet</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
            Create one to open a terminal session for this task and work with an agent.
          </p>
          <Button
            className="mt-5"
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
        </div>
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
