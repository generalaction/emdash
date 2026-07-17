import { useEffect } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { useRegisterNotificationOpenHandlers } from '@root/src/core/services/notifications/browser';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { currentView } = useWorkspaceSlots();
  const showConfirmQuitModal = useShowModal('confirmActionModal');
  const showFeedbackModal = useShowModal('feedbackModal');
  useRegisterNotificationOpenHandlers();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.host.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'menu-open-settings') {
            if (currentView !== 'settings') {
              const shouldOpen = onOpenSettings?.() ?? true;
              if (shouldOpen === false) return;
            }
            toggleSettingsView();
          } else if (event.type === 'menu-quit-requested') {
            showConfirmQuitModal({
              title: 'Quit Emdash?',
              description:
                'Active terminal sessions and running agents will stop when the app quits.',
              confirmLabel: 'Quit',
              onSuccess: () => {
                void getDesktopWireClient().then((nextClient) => nextClient.host.quit());
              },
            });
          } else if (event.type === 'menu-give-feedback') {
            showFeedbackModal({});
          }
        },
        onGap: () => {},
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [currentView, onOpenSettings, showConfirmQuitModal, showFeedbackModal]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.browser.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type !== 'link-copied') return;
          const title =
            event.kind === 'url'
              ? 'Browser URL copied'
              : event.kind === 'image'
                ? 'Image URL copied'
                : 'Link copied';
          toast({ title });
        },
        onGap: () => {},
      });
      if (disposed) nextUnsubscribe();
      else unsubscribe = nextUnsubscribe;
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  return null;
}
