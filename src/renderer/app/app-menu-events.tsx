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
  deepLinkChannel,
  notificationFocusTaskChannel,
} from '@shared/events/appEvents';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();
  const showConfirmQuitModal = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');
  const showImportShareModal = useShowModal('importShareModal');

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
    return events.on(deepLinkChannel, ({ url }) => {
      const parsed = parseShareDeepLink(url);
      if (!parsed) return;
      showImportShareModal(parsed);
    });
  }, [showImportShareModal]);

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

function parseShareDeepLink(urlValue: string): { type: 'skill' | 'prompt'; id: string } | null {
  try {
    const url = new URL(urlValue);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname !== 'share' || parts.length !== 2) return null;
    const [typePath, id] = parts;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    if (typePath === 'skills') return { type: 'skill', id };
    if (typePath === 'prompts') return { type: 'prompt', id };
    return null;
  } catch {
    return null;
  }
}
