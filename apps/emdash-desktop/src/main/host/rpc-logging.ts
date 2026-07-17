import { type IpcMain } from 'electron';
import { log } from '@main/lib/logger';

export function withRpcLogging(target: IpcMain): IpcMain {
  return new Proxy(target, {
    get(obj, prop, receiver) {
      if (prop !== 'handle') return Reflect.get(obj, prop, receiver);
      return (channel: string, handler: (...a: unknown[]) => unknown) =>
        obj.handle(channel, async (event, ...args: unknown[]) => {
          try {
            const result = await handler(event, ...args);
            log.debug('rpc result', { channel, args, result });
            return result;
          } catch (err) {
            log.error('rpc error', { channel, args, err });
            throw err;
          }
        });
    },
  });
}
