import type { Unsubscribe } from '@emdash/shared';
import type { LiveSource } from '../live/protocol';
import type { Controller } from './bind';
import type { Connection } from './connect';

export function relayController(upstream: Connection): Controller {
  return {
    call(path, input, meta = {}) {
      return upstream.call(path, input, { signal: meta.signal });
    },
    resolveLive(topic): LiveSource {
      return {
        snapshot: () => upstream.snapshot(topic),
        subscribe: (cb): Unsubscribe => {
          let disposed = false;
          const attach = upstream.attach(topic, cb).catch(() => () => {});
          void attach.then((detach) => {
            if (disposed) detach();
          });
          return () => {
            disposed = true;
            void attach.then((detach) => detach());
          };
        },
      };
    },
    liveRefIds() {
      return 'dynamic';
    },
  };
}
