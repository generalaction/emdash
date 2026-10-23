import { createScope } from '@emdash/shared/concurrency';
import { when } from 'mobx';
import { useEffect } from 'react';
import { conversationTabKind } from '@core/features/conversations/api/browser/conversation-tab-kind';
import { conversationRegistry } from '@core/features/conversations/api/browser/stores/conversation-registry';
import { taskViewDef } from '@core/features/tasks/contributions/views';
import { getUpdateStore } from '@core/features/updates/contributions/app-stores';
import { getTaskComposition } from '@core/features/workbench/api/browser/task-composition-selectors';
import { useNavigate } from '@core/primitives/navigation/browser/navigation-hooks';
import { registerNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';

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
          // The task can become available before its conversation list has loaded.
          // Wait for the record so an ACP conversation never defaults to a PTY tab.
          () =>
            !!getTaskComposition(target.projectId, target.taskId) &&
            !!conversationRegistry.get(target.taskId)?.conversations.has(conversationId),
          () => {
            const conversation = conversationRegistry
              .get(target.taskId)
              ?.conversations.get(conversationId);
            if (!conversation) return;
            getTaskComposition(target.projectId, target.taskId)?.paneLayout.open(
              conversationTabKind(conversation.data.type),
              { conversationId },
              { preview: false }
            );
          },
          {
            timeout: 10_000,
            onError: (error) => {
              scope.log.warn('Notification conversation target is unavailable', {
                projectId: target.projectId,
                taskId: target.taskId,
                conversationId,
                error,
              });
            },
          }
        );
        scope.add(dispose);
      })
    );

    scope.add(
      registerNotificationOpenHandler('update', () => {
        void getUpdateStore().install();
      })
    );
    scope.add(registerNotificationOpenHandler('none', () => {}));

    return () => {
      void scope.dispose();
    };
  }, [navigate]);
}
