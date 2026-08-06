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
  /** Activate per-worker vitals self-sampling (telemetry-sampled sessions only). */
  startWorkerVitalsSampling(intervalMs: number): void;
  /** Toggle verbose per-spawn logging in every live and future worker. */
  setWorkerSpawnLogging(enabled: boolean): void;
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
    startWorkerVitalsSampling: (intervalMs) => workers.startVitalsSampling(intervalMs),
    setWorkerSpawnLogging: (enabled) => workers.setSpawnLogging(enabled),
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
