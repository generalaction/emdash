import { Command } from 'cmdk';
import { useObserver } from 'mobx-react-lite';
import {
  asMounted,
  getProjectManagerStore,
} from '@renderer/features/projects/stores/project-selectors';
import type { ConversationStore } from '@renderer/features/tasks/conversations/conversation-manager';
import type { TaskStore } from '@renderer/features/tasks/stores/task';
import { asProvisioned, getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';
import { PaletteConversationItem } from './palette-conversation-item';
import { PaletteTaskItem } from './palette-task-item';

type NotificationItem =
  | { kind: 'task'; projectId: string; taskStore: TaskStore }
  | { kind: 'conversation'; projectId: string; taskId: string; conv: ConversationStore };

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
  const items = useObserver((): NotificationItem[] => {
    const result: NotificationItem[] = [];

    for (const projectStore of getProjectManagerStore().projects.values()) {
      const mounted = asMounted(projectStore);
      if (!mounted) continue;
      const pid = mounted.data.id;

      for (const [tid, taskStore] of mounted.taskManager.tasks) {
        const provisioned = asProvisioned(taskStore);
        if (!provisioned) continue;

        const status = provisioned.conversations.taskStatus;
        // Only surface awaiting-input, error, completed — not working or idle.
        if (!status || status === 'idle' || status === 'working') continue;

        if (pid === currentProjectId && tid === currentTaskId) {
          // We're already in this task — surface individual unseen conversations.
          for (const conv of provisioned.conversations.conversations.values()) {
            if (!conv.seen && conv.indicatorStatus) {
              result.push({ kind: 'conversation', projectId: pid, taskId: tid, conv });
            }
          }
        } else {
          result.push({ kind: 'task', projectId: pid, taskStore });
        }
      }
    }

    return result;
  });

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
                getTaskView(item.projectId, item.taskId)?.tabManager.openConversation(
                  item.conv.data.id
                );
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
