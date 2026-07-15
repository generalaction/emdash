import { when } from 'mobx';
import { useEffect } from 'react';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';
import type { NotificationTarget } from '../api';

type NotificationOpenHandler<T extends NotificationTarget = NotificationTarget> = (
  target: T,
  notificationId: string
) => void | Promise<void>;

const handlers = new Map<NotificationTarget['kind'], NotificationOpenHandler>();

export function registerNotificationOpenHandler<K extends NotificationTarget['kind']>(
  kind: K,
  handler: NotificationOpenHandler<Extract<NotificationTarget, { kind: K }>>
): () => void {
  handlers.set(kind, handler as NotificationOpenHandler);
  return () => {
    if (handlers.get(kind) === handler) handlers.delete(kind);
  };
}

export function runNotificationOpenHandler(
  target: NotificationTarget,
  notificationId: string
): void {
  void handlers.get(target.kind)?.(target, notificationId);
}

export function useRegisterNotificationOpenHandlers(): void {
  const { navigate } = useNavigate();

  useEffect(() => {
    const disposers = new Set<() => void>();
    const unregisterTask = registerNotificationOpenHandler('task', (target) => {
      navigate('task', { projectId: target.projectId, taskId: target.taskId });
      const { conversationId } = target;
      if (!conversationId) return;

      const dispose = when(
        () => !!getTaskView(target.projectId, target.taskId),
        () => {
          getTaskView(target.projectId, target.taskId)?.paneLayout.open(
            'conversation',
            { conversationId },
            { preview: false }
          );
        },
        { timeout: 10_000 }
      );
      disposers.add(dispose);
    });

    const unregisterUpdate = registerNotificationOpenHandler('update', () => {
      void appState.update.install();
    });

    const unregisterNone = registerNotificationOpenHandler('none', () => {});

    return () => {
      unregisterTask();
      unregisterUpdate();
      unregisterNone();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
    };
  }, [navigate]);
}
