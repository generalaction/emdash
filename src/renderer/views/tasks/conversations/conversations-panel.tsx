import { useHotkey } from '@tanstack/react-hotkeys';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useTaskViewContext } from '../task-view-context';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const conversationMgr = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const { value: keyboard } = useAppSettingsKey('keyboard');

  const handleCreate = () =>
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => conversationMgr?.setActiveTab(conversationId),
    });

  useTabShortcuts(conversationMgr);
  useHotkey(getEffectiveHotkey('newConversation', keyboard), handleCreate);

  return (
    <TabbedPtyPanel
      store={conversationMgr}
      paneId="conversations"
      getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
      getSession={(s) => s.session}
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
              onClick={handleCreate}
              className="flex items-center gap-2"
            >
              Create conversation
              <ShortcutHint settingsKey="newConversation" />
            </Button>
          }
        />
      }
    />
  );
});
