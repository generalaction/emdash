import { useEffect } from 'react';
import { COMMAND_CATALOG } from '@core/manifests/command-catalog';
import { scopes } from '@core/primitives/view-scopes/browser';
import { toast } from '@renderer/lib/hooks/use-toast';
import { useOpenModal } from '@renderer/lib/modal/api';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { useRegisterNotificationOpenHandlers } from '@root/src/core/services/notifications/browser';

export function AppMenuEvents({ onOpenSettings }: { onOpenSettings?: () => boolean | void }) {
  const openConfirmQuitModal = useOpenModal('confirmActionModal');
  useRegisterNotificationOpenHandlers();

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    void getDesktopWireClient().then(async (client) => {
      const nextUnsubscribe = await client.host.events.subscribe(undefined, {
        onEvent: (event) => {
          if (event.type === 'menu-command') {
            const command = COMMAND_CATALOG.byId(event.commandId);
            if (!command) return;
            if (command.id === 'app.settings' && onOpenSettings?.() === false) return;
            const execute = () => {
              const bound = scopes.getActiveCommand(command);
              if (!bound) return false;
              if (bound.availability.kind === 'enabled') {
                bound.execute(undefined, 'menu');
              }
              return true;
            };
            if (!execute()) {
              requestAnimationFrame(() => {
                if (!execute() && import.meta.env.DEV) {
                  console.warn(`Menu command has no active binding: ${command.id}`);
                }
              });
            }
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
  }, [onOpenSettings, openConfirmQuitModal]);

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
