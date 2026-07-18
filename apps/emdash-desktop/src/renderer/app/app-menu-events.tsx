import { useEffect } from 'react';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useWorkspaceSlots } from '@renderer/lib/layout/navigation-provider';
import { toggleSettingsView } from '@renderer/lib/layout/settings-toggle';
import { useOpenModal } from '@renderer/lib/modal/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { useRegisterNotificationOpenHandlers } from '@root/src/core/services/notifications/browser';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const { currentView } = useWorkspaceSlots();
  const openConfirmQuitModal = useOpenModal('confirmActionModal');
  const openFeedbackModal = useOpenModal('feedbackModal');
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
            void openConfirmQuitModal({
              title: 'Quit Emdash?',
              description:
                'Active terminal sessions and running agents will stop when the app quits.',
              confirmLabel: 'Quit',
            }).then((outcome) => {
              if (outcome.success) {
                void getDesktopWireClient().then((nextClient) => nextClient.host.quit());
              }
            });
          } else if (event.type === 'menu-give-feedback') {
            void openFeedbackModal({});
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
  }, [currentView, onOpenSettings, openConfirmQuitModal, openFeedbackModal]);

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
