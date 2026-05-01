import { useHotkey } from '@tanstack/react-hotkeys';
import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { TabbedPtyPanel } from '@renderer/features/tasks/tabbed-pty-panel';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { ContextBar } from './context-bar';
import { type ConversationStore } from './conversation-manager';
import { ConversationsTabs } from './conversation-tabs';

export const ConversationsPanel = observer(function ConversationsPanel() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const conversationTabs = provisioned.taskView.conversationTabs;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const isActive = useIsActiveTask(taskId);
  const [isPanelFocused, setIsPanelFocused] = useState(false);
  const mountedProject = asMounted(getProjectStore(projectId));
  const shouldSetWorkingOnEnter = mountedProject?.data.type !== 'ssh';
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;
  const newConversationHotkey = getEffectiveHotkey('newConversation', keyboard);

  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

  const handleCreate = () =>
    showCreateConversationModal({
      connectionId: remoteConnectionId,
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        conversationTabs.setActiveTab(conversationId);
        provisioned.taskView.setFocusedRegion('main');
      },
    });

  useTabShortcuts(conversationTabs, { focused: isPanelFocused });
  useHotkey(getHotkeyRegistration('newConversation', keyboard), handleCreate, {
    enabled: newConversationHotkey !== null,
  });

  useEffect(() => {
    conversationTabs.setVisible(isActive);
    return () => {
      conversationTabs.setVisible(false);
    };
  }, [conversationTabs, isActive]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <TabbedPtyPanel<ConversationStore>
          autoFocus={autoFocus}
          onFocusChange={(focused) => {
            setIsPanelFocused(focused);
            if (focused) provisioned.taskView.setFocusedRegion('main');
          }}
          store={conversationTabs}
          paneId="conversations"
          getSession={(s) => s.session}
          onEnterPress={shouldSetWorkingOnEnter ? (s) => s.setWorking() : undefined}
          onInterruptPress={(s) => s.clearWorking()}
          mapShiftEnterToCtrlJ
          remoteConnectionId={remoteConnectionId}
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
      </div>
      <ContextBar />
    </div>
  );
});
