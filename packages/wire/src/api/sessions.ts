import type { Unsubscribe } from '@emdash/shared';
import type { Controller } from './bind';
import type { WireTransport } from './protocol';
import { serve } from './serve';

export type WireSessionHub = {
  open(sessionId: string | number, transport: WireTransport): Unsubscribe;
  close(sessionId: string | number): void;
  dispose(): void;
};

type SessionRecord = {
  dispose: Unsubscribe;
  disconnect: Unsubscribe;
};

export function createWireSessionHub(controller: Controller): WireSessionHub {
  const sessions = new Map<string, SessionRecord>();

  function close(sessionId: string | number): void {
    const key = String(sessionId);
    const session = sessions.get(key);
    if (!session) return;
    sessions.delete(key);
    session.disconnect();
    session.dispose();
  }

  return {
    open(sessionId, transport) {
      const key = String(sessionId);
      close(key);
      const dispose = serve(transport, controller);
      const disconnect = transport.onDisconnect(() => close(key));
      sessions.set(key, { dispose, disconnect });
      return () => close(key);
    },
    close,
    dispose() {
      for (const key of [...sessions.keys()]) close(key);
      controller.dispose?.();
    },
  };
}
