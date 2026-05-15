import { MessageSquare } from 'lucide-react';
import { useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { useTabGroupContext } from '../tabs/tab-group-context';

export function PaneEmptyState() {
  const { projectId, taskId } = useTaskViewContext();
  const { tabManager: paneTabManager } = useTabGroupContext();
  const showCreateConversationModal = useShowModal('createConversationModal');

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <MessageSquare className="h-10 w-10 opacity-20" />
      <div className="text-center">
        <p className="text-sm font-medium opacity-50">No open tabs</p>
        <p className="mt-1 text-xs opacity-35">Open a conversation from the sidebar</p>
      </div>
      <Button
        size="sm"
        variant="outline"
        onClick={() =>
          showCreateConversationModal({
            projectId,
            taskId,
            onSuccess: ({ conversationId }) => paneTabManager.openConversation(conversationId),
          })
        }
        className="flex items-center gap-2"
      >
        New conversation
        <ShortcutHint settingsKey="newConversation" />
      </Button>
    </div>
  );
}
