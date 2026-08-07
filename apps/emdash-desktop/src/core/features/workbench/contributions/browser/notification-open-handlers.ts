import { createScope } from '@emdash/shared/concurrency';
import { when } from 'mobx';
import { useEffect } from 'react';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { registerNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { appState } from '@renderer/lib/stores/app-state';

export function useRegisterNotificationOpenHandlers(): void {
  const { navigate } = useNavigate();

  useEffect(() => {
    // Disposal registry, not event dispatch: `when` disposers accumulate per
    // handled notification and are only torn down together on unmount.
    const scope = createScope({ label: 'notification-open-handlers' });
    scope.add(
      registerNotificationOpenHandler('task', (target) => {
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
        scope.add(dispose);
      })
    );

    scope.add(
      registerNotificationOpenHandler('update', () => {
        void appState.update.install();
      })
    );
    scope.add(registerNotificationOpenHandler('none', () => {}));

    return () => {
      void scope.dispose();
    };
  }, [navigate]);
}
