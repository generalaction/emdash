import { useHotkey } from '@tanstack/react-hotkeys';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useTaskViewContext } from '../task-view-context';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const conversationMgr = asProvisioned(getTaskStore(projectId, taskId))?.conversations;
  const taskStore = asProvisioned(getTaskStore(projectId, taskId));
  const showCreateConversationModal = useShowModal('createConversationModal');
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);

  const autoFocus = isActive && taskStore?.focusedRegion === 'main';

  const handleCreate = () =>
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        conversationMgr?.setActiveTab(conversationId);
        taskStore?.setFocusedRegion('main');
      },
    });

  useTabShortcuts(conversationMgr, { focused: isPanelFocused });
  useHotkey(getEffectiveHotkey('newConversation', keyboard), handleCreate);

  return (
    <TabbedPtyPanel
      autoFocus={autoFocus}
      onFocusChange={(focused) => {
        setIsPanelFocused(focused);
        if (focused) taskStore?.setFocusedRegion('main');
      }}
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
