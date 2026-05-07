import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { asMounted, getProjectStore } from '@renderer/features/projects/stores/project-selectors';
import { useIsActiveTask } from '@renderer/features/tasks/hooks/use-is-active-task';
import { TabbedPtyPanel } from '@renderer/features/tasks/tabbed-pty-panel';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { ContextBar } from './context-bar';
import { type ConversationStore } from './conversation-manager';

export const ConversationsPanel = observer(function ConversationsPanel({
  hideTabBar: _hideTabBar = false,
}: {
  hideTabBar?: boolean;
}) {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { tabManager } = provisioned.taskView;
  const showCreateConversationModal = useShowModal('createConversationModal');
  const isActive = useIsActiveTask(taskId);
  const mountedProject = asMounted(getProjectStore(projectId));
  const shouldSetWorkingOnEnter = mountedProject?.data.type !== 'ssh';
  const remoteConnectionId =
    mountedProject?.data.type === 'ssh' ? mountedProject.data.connectionId : undefined;

  const autoFocus = isActive && provisioned.taskView.focusedRegion === 'main';

  const handleCreate = () =>
    showCreateConversationModal({
      connectionId: remoteConnectionId,
      projectId,
      taskId,
      onSuccess: ({ conversationId }) => {
        tabManager.openConversation(conversationId);
        provisioned.taskView.setFocusedRegion('main');
      },
    });

  // The newConversation hotkey (Mod+Shift+C) is handled by CommandShortcutBinder
  // via createTaskCommandProvider — active even when this panel is not mounted.

  useEffect(() => {
    tabManager.setVisible(isActive);
    return () => {
      tabManager.setVisible(false);
    };
  }, [tabManager, isActive]);

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1">
        <TabbedPtyPanel<ConversationStore>
          autoFocus={autoFocus}
          onFocusChange={(focused) => {
            if (focused) provisioned.taskView.setFocusedRegion('main');
          }}
          store={tabManager.conversationAdapter}
          paneId="conversations"
          getSession={(s) => s.session}
          onEnterPress={
            shouldSetWorkingOnEnter
              ? (s) => {
                  s.setWorking();
                  void provisioned.conversations.touchConversation(s.data.id);
                }
              : undefined
          }
          onInterruptPress={(s) => s.clearWorking()}
          mapShiftEnterToCtrlJ
          remoteConnectionId={remoteConnectionId}
          tabBar={<></>}
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
