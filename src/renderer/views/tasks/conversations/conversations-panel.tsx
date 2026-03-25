import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useTaskViewContext } from '../task-view-context';
import { getTaskStore, provisionedTask } from '../task-view-state';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const conversationMgr = provisionedTask(getTaskStore(projectId, taskId))?.conversations;
  const showCreateConversationModal = useShowModal('createConversationModal');

  useTabShortcuts(conversationMgr);

  return (
    <TabbedPtyPanel
      store={conversationMgr}
      paneId="conversations"
      getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
      tabBar={<ConversationsTabs projectId={projectId} taskId={taskId} />}
      emptyState={
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
                  onSuccess: ({ conversationId }) => conversationMgr?.setActiveTab(conversationId),
                })
              }
            >
              Create conversation
            </Button>
          }
        />
      }
    />
  );
});
