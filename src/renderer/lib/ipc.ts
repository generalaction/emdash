import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';
import { createRPCClient } from '@shared/ipc/rpc';
import type { RpcRouter } from '@main/rpc';

export const rpc = createRPCClient<RpcRouter>(window.electronAPI.invoke);

function createRendererAdapter(): EmitterAdapter {
  return {
    emit: (eventName: string, data: unknown, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      window.electronAPI.eventSend(channel, data);
    },
    on: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      return window.electronAPI.eventOn(channel, cb);
    },
  };
}

export const events = createEventEmitter(createRendererAdapter());
