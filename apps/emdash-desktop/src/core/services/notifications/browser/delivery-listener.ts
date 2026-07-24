import { runNotificationOpenHandler } from '@core/primitives/notifications/browser/open-handlers';
import { getDesktopWireClient } from '@renderer/lib/runtime/desktop-wire-client';
import { soundPlayer } from '@renderer/utils/soundPlayer';

let cleanup: (() => void) | null = null;

export function initNotificationDeliveryListener(): () => void {
  if (cleanup) return cleanup;

  let disposed = false;
  let unsubscribe: (() => void) | null = null;

  void getDesktopWireClient()
    .then((client) =>
      client.notifications.delivery.subscribe(undefined, {
        onEvent(event) {
          if (event.type === 'sound') {
            soundPlayer.play(event.sound, event.notificationId);
          } else {
            runNotificationOpenHandler(event.target, event.notificationId);
          }
        },
        onGap() {},
        onError() {},
      })
    )
    .then((nextUnsubscribe) => {
      if (disposed) {
        nextUnsubscribe();
        return;
      }
      unsubscribe = nextUnsubscribe;
    })
    .catch(() => {});

  cleanup = () => {
    disposed = true;
    unsubscribe?.();
    unsubscribe = null;
    cleanup = null;
  };
  return cleanup;
}
