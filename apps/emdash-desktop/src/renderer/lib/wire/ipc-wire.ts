import type { LiveSnapshot } from '@emdash/core/live';
import type { Wire } from '@emdash/core/wire';
import { events, rpc } from '@renderer/lib/ipc';
import { wireEventTopic, wireLiveUpdateChannel } from '@shared/lib/wire/events';

type WireRpcClient = {
  call(path: string, input: unknown): Promise<unknown>;
  liveSnapshot(topic: string): Promise<unknown>;
  liveSubscribe(topic: string): Promise<void>;
  liveUnsubscribe(topic: string): Promise<void>;
};

export function ipcWire(ns: string): Wire {
  const controller = (rpc as unknown as Record<string, WireRpcClient>)[ns];
  if (!controller) {
    throw new Error(`Unknown wire RPC namespace '${ns}'`);
  }

  return {
    procedures: {
      call: (path, input) => controller.call(path, input),
    },
    live: {
      snapshot: (topic) => controller.liveSnapshot(topic) as Promise<LiveSnapshot<unknown>>,
      async attach(topic, push) {
        const unsubscribeEvent = events.on(wireLiveUpdateChannel, push, wireEventTopic(ns, topic));
        try {
          await controller.liveSubscribe(topic);
        } catch (error) {
          unsubscribeEvent();
          throw error;
        }
        return () => {
          unsubscribeEvent();
          void controller.liveUnsubscribe(topic);
        };
      },
    },
    onDisconnect: () => () => {},
  };
}
