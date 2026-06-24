import { Command } from 'cmdk';
import { useObserver } from 'mobx-react-lite';
import { getTaskNotificationItems } from '@renderer/features/tasks/stores/task-notifications';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { PaletteConversationItem } from './palette-conversation-item';
import { PaletteTaskItem } from './palette-task-item';

const GROUP_CLASS = cn(
  '[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5',
  '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
  '[&_[cmdk-group-heading]]:text-foreground/50'
);

interface PaletteNotificationsGroupProps {
  currentProjectId: string | undefined;
  currentTaskId: string | undefined;
  onClose: () => void;
  navigate: NavigateFnTyped;
}

export function PaletteNotificationsGroup({
  currentProjectId,
  currentTaskId,
  onClose,
  navigate,
}: PaletteNotificationsGroupProps) {
  const items = useObserver(() => getTaskNotificationItems(currentProjectId, currentTaskId));

  if (items.length === 0) return null;

  return (
    <Command.Group heading="Notifications" className={GROUP_CLASS}>
      {items.map((item) => {
        if (item.kind === 'conversation') {
          return (
            <PaletteConversationItem
              key={item.conv.data.id}
              conv={item.conv}
              value={`notif:conversation:${item.conv.data.id}`}
              onSelect={() => {
                getTaskView(item.projectId, item.taskId)?.paneLayout.open('conversation', {
                  conversationId: item.conv.data.id,
                  preview: false,
                });
                if (item.projectId !== currentProjectId || item.taskId !== currentTaskId) {
                  navigate('task', { projectId: item.projectId, taskId: item.taskId });
                }
                onClose();
              }}
            />
          );
        }
        return (
          <PaletteTaskItem
            key={item.taskStore.data.id}
            taskStore={item.taskStore}
            value={`notif:task:${item.taskStore.data.id}`}
            onSelect={() => {
              navigate('task', {
                projectId: item.projectId,
                taskId: item.taskStore.data.id,
              });
              onClose();
            }}
          />
        );
      })}
    </Command.Group>
  );
}
