import { when } from 'mobx';
import { useEffect } from 'react';
import { menuOpenSettingsChannel, notificationFocusTaskChannel } from '@shared/events/appEvents';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { events } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();

  useEffect(() => {
    return events.on(menuOpenSettingsChannel, () => {
      if (currentView !== 'settings') {
        const shouldOpen = onOpenSettings?.() ?? true;
        if (shouldOpen === false) return;
      }

      toggleSettingsView(navigate, currentView, lastNonSettingsView);
    });
  }, [navigate, onOpenSettings, currentView, lastNonSettingsView]);

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
