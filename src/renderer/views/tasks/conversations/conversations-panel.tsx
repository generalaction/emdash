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
import { useTaskViewContext } from '../task-view-context';
import { getTaskStore, provisionedTask } from '../task-view-state';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const conversationMgr = provisionedTask(getTaskStore(projectId, taskId))?.conversations;

  const showCreateConversationModal = useShowModal('createConversationModal');

  const conversationStores = conversationMgr
    ? Array.from(conversationMgr.conversations.values())
    : [];
  const conversations = conversationStores.map((c) => c.data);

  const activeConversationId = conversationMgr?.tabs.activeTabId;
  const setActiveConversationId = (id: string) => conversationMgr?.tabs.setActiveTab(id);

  const activeId = activeConversationId ?? conversations[0]?.id ?? null;
  const activeConversation = conversations.find((c) => c.id === activeId) ?? null;

  const allSessionIds = useMemo(
    () => conversations.map((c) => makePtySessionId(projectId, taskId, c.id)),
    [conversations, projectId, taskId]
  );

  const sessionId = activeConversation
    ? makePtySessionId(projectId, taskId, activeConversation.id)
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
                projectId,
                taskId,
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
        <ConversationsTabs projectId={projectId} taskId={taskId} />
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
