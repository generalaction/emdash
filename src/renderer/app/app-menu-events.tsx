import { when } from 'mobx';
import { useEffect } from 'react';
import { menuOpenSettingsChannel, notificationFocusTaskChannel } from '@shared/events/appEvents';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { events } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      const shouldOpen = onOpenSettings?.() ?? true;
      if (shouldOpen === false) return;
      if (currentView === 'settings') return;

      navigate('settings');
    });
  }, [navigate, onOpenSettings, currentView]);

  useEffect(() => {
    const disposers = new Set<() => void>();

    const unlisten = events.on(
      notificationFocusTaskChannel,
      ({ projectId, taskId, conversationId }) => {
        navigate('task', { projectId, taskId });
        if (!conversationId) return;

        // Task view may not be provisioned yet — wait for it before opening the conversation tab.
        const dispose = when(
          () => !!getTaskView(projectId, taskId),
          () => {
            getTaskView(projectId, taskId)?.tabManager.openConversation(conversationId);
          },
          {
            timeout: 10_000,
          }
        );
        disposers.add(dispose);
      }
    );

    return () => {
      unlisten();
      disposers.forEach((dispose) => dispose());
      disposers.clear();
    };
  }, [navigate]);

  return null;
}
