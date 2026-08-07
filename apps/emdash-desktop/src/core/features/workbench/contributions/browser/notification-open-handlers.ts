import { when } from 'mobx';
import { useEffect } from 'react';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { registerNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';

export function useRegisterNotificationOpenHandlers(): void {
  const { navigate } = useNavigate();

  useEffect(() => {
    const disposers = new Set<() => void>();
    const unregisterTask = registerNotificationOpenHandler('task', (target) => {
      navigate(taskViewDef({ projectId: target.projectId, taskId: target.taskId }));
      const { conversationId } = target;
      if (!conversationId) return;

      const dispose = when(
        () => !!getTaskComposition(target.projectId, target.taskId),
        () => {
          getTaskComposition(target.projectId, target.taskId)?.paneLayout.open(
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
      void getUpdateStore().install();
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
