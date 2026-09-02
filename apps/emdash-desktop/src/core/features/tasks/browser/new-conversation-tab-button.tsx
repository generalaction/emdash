import { Button, Tooltip } from '@emdash/ui/react/primitives';
import { Plus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useTaskViewContext } from '@core/features/tasks/contributions/browser/task-view-context';
import { useOpenModal } from '@core/manifests/browser/modal-api';
import { BoundShortcut } from '@core/primitives/keybindings/browser/shortcut';
import { usePaneContext } from '@core/primitives/workbench-shell/browser/tabs/pane-context';

/**
 * The "+" rendered after the last tab in the tab strip (browser-tab idiom).
 * Opens the create-conversation modal into this pane, so in a split layout it
 * doubles as "create the conversation here".
 */
export const NewConversationTabButton = observer(function NewConversationTabButton() {
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
    <Tooltip.Root>
      <Tooltip.Trigger>
        <Button
          size="sm"
          icon
          variant="ghost"
          onClick={handleCreateConversation}
          aria-label="New conversation"
        >
          <Plus className="size-3.5" />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Content>
        New Conversation <BoundShortcut command="task.newConversation" variant="keycaps" />
      </Tooltip.Content>
    </Tooltip.Root>
  );
});
