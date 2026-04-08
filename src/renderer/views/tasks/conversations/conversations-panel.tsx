import { useHotkey } from '@tanstack/react-hotkeys';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { makePtySessionId } from '@shared/ptySessionId';
import { Button } from '@renderer/components/ui/button';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { ShortcutHint } from '@renderer/components/ui/shortcut-hint';
import { useAppSettingsKey } from '@renderer/core/app/use-app-settings-key';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { getEffectiveHotkey } from '@renderer/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/hooks/useTabShortcuts';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { TabbedPtyPanel } from '../tabbed-pty-panel';
import { useProvisionedTask, useTaskViewContext } from '../task-view-context';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const conversationTabs = provisioned.taskView.conversationTabs;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);

  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

  const handleCreate = () =>
    showCreateConversationModal({
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        conversationTabs.setActiveTab(conversationId);
        provisioned.taskView.setFocusedRegion('main');
      },
    });

  useTabShortcuts(conversationTabs, { focused: isPanelFocused });
  useHotkey(getEffectiveHotkey('newConversation', keyboard), handleCreate);

  useEffect(() => {
    conversationTabs.setVisible(isActive);
    return () => {
      conversationTabs.setVisible(false);
    };
  }, [conversationTabs, isActive]);

  return (
    <TabbedPtyPanel
      autoFocus={autoFocus}
      onFocusChange={(focused) => {
        setIsPanelFocused(focused);
        if (focused) provisioned.taskView.setFocusedRegion('main');
      }}
      store={conversationTabs}
      paneId="conversations"
      getSessionId={(s) => makePtySessionId(projectId, taskId, s.data.id)}
      getSession={(s) => s.session}
      onEnterPress={(s) => s.setWorking()}
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
