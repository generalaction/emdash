import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';

export const TabBarActions = observer(function TabBarActions() {
  const { projectId, taskId } = useTaskViewContext();
  const { pane } = usePaneContext();
  const openCreateConversationModal = useOpenModal('createConversationModal');

  const handleCreateConversation = () => {
    void (async () => {
      const outcome = await openCreateConversationModal({ projectId, taskId });
      if (!outcome.success) return;
      const { conversationId, type } = outcome.data;
      if (type === 'acp') {
        pane.open('acp-chat', { conversationId, preview: false });
      } else {
        pane.open('conversation', { conversationId, preview: false });
      }
    })();
  };

  return (
    <div className="flex h-full shrink-0 items-center px-2">
      <Tooltip.Root>
        <Tooltip.Trigger>
          <Button size="sm" icon variant="ghost" onClick={handleCreateConversation}>
            <MessageSquarePlus className="size-3.5" />
          </Button>
        </Tooltip.Trigger>
        <Tooltip.Content>
          New Conversations <BoundShortcut command="task.newConversation" variant="keycaps" />
        </Tooltip.Content>
      </Tooltip.Root>
    </div>
  );
});
