import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Scope } from '@emdash/shared/concurrency';
import type {
  DesktopRuntimeClients,
  DesktopRuntimeWorkers,
  DesktopWorkersHandle,
} from './desktop-workers';

export type DesktopRuntimes = {
  readonly broker: RuntimeBroker;
  readonly clients: DesktopRuntimeClients;
  readonly workers: DesktopRuntimeWorkers;
  dispose(): Promise<void>;
};

export function desktopRuntimes(
  workers: DesktopWorkersHandle,
  broker: RuntimeBroker,
  scope: Scope
): DesktopRuntimes {
  let disposePromise: Promise<void> | undefined;
  return {
    broker,
    clients: workers.clients,
    workers: workers.workers,
    dispose() {
      disposePromise ??= (async () => {
        try {
          await workers.dispose();
        } finally {
          await scope.dispose();
        }
      })();
      return disposePromise;
    },
  };
}
