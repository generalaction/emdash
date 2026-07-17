import { mementoCatalog } from '@core/manifests/memento-catalog';
import { getMementosWireClient, MementoClient } from '@core/primitives/mementos/browser';
import { log } from '@renderer/utils/logger';

let client: MementoClient | undefined;
let initializing: Promise<MementoClient> | undefined;

export function initMementos(): Promise<MementoClient> {
  if (client) return Promise.resolve(client);
  initializing ??= getMementosWireClient().then((wire) => {
    client = new MementoClient(wire, {
      catalog: mementoCatalog,
      onError: (error) => log.error('Memento operation failed:', error),
    });
    return client;
  });
  return initializing;
}

export function getMementoClient(): MementoClient {
  if (!client) throw new Error('Mementos have not been initialized');
  return client;
}
