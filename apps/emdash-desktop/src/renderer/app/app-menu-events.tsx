import { useRegisterNotificationOpenHandlers } from '@services/notifications/browser';
import { useEffect } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events, rpc } from '@renderer/lib/ipc';
import { useNavigate, useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import {
  menuGiveFeedbackChannel,
  menuOpenSettingsChannel,
  menuQuitRequestedChannel,
} from '@shared/events/appEvents';
import { browserLinkCopiedChannel } from '@shared/events/browserEvents';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { navigate } = useNavigate();
  const { currentView, lastNonSettingsView } = useWorkspaceSlots();
  const showConfirmQuitModal = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');
  useRegisterNotificationOpenHandlers();

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
    return events.on(browserLinkCopiedChannel, ({ kind }) => {
      const title =
        kind === 'url'
          ? 'Browser URL copied'
          : kind === 'image'
            ? 'Image URL copied'
            : 'Link copied';
      toast({ title });
    });
  }, []);

  return null;
}
