import { createEventEmitter, type EmitterAdapter } from '@shared/ipc/events';
import { createRPCClient } from '@shared/ipc/rpc';
import type { RpcRouter } from '@main/ipc';

const invoke = (
  window.electronAPI as unknown as {
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  }
).invoke;

export const rpc = createRPCClient<RpcRouter>(invoke);

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
    // once is intentionally omitted: createEventEmitter.once uses adapter.on (getOrAttach),
    // so adapter.once is never called. The EmitterAdapter type requires the method, so
    // we delegate to on() as a safe fallback.
    once: (eventName: string, cb: (data: unknown) => void, topic?: string) => {
      const channel = topic ? `${eventName}.${topic}` : eventName;
      return window.electronAPI.eventOn(channel, cb);
    },
  };
}

export const events = createEventEmitter(createRendererAdapter());
