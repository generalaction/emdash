import { when } from 'mobx';
import { useEffect } from 'react';
import { getTaskView } from '@renderer/features/tasks/stores/task-selectors';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
  notificationFocusTaskChannel,
} from '@shared/events/appEvents';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();
  const showConfirmQuitModal = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');

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
    return events.on(menuQuitRequestedChannel, () => {
      showConfirmQuitModal({
        title: 'Quit Emdash?',
        description: 'Active terminal sessions and running agents will stop when the app quits.',
        confirmLabel: 'Quit',
        onSuccess: () => {
          void rpc.app.quit();
        },
      });
    });
  }, [showConfirmQuitModal]);

  useEffect(() => {
    return events.on(menuGiveFeedbackChannel, () => {
      showFeedbackModal({});
    });
  }, [showFeedbackModal]);

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
            getTaskView(projectId, taskId)?.tabGroupManager.openConversation(conversationId);
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
