import type { Scope } from '@emdash/shared/concurrency';
import type { Clock } from '@emdash/shared/scheduling';
import type { AppDb } from '@core/services/app-db/node/db';
import type {
  OperationDefinition,
  OperationsNotificationPublisher,
  OperationsSshManager,
} from './definition';
import { OperationsEngine } from './operations-engine';

export type CreateOperationsEngineDeps = {
  scope: Scope;
  db: AppDb;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  clock?: Clock;
};

export type OperationsEngineHandle = {
  readonly engine: OperationsEngine;
  dispose(): Promise<void>;
};

export async function createOperationsEngine(
  deps: CreateOperationsEngineDeps
): Promise<OperationsEngineHandle> {
  const scope = deps.scope.child('operations-engine');
  const engine = new OperationsEngine({ ...deps, scope });
  await engine.start();

  let disposePromise: Promise<void> | undefined;
  return {
    engine,
    dispose() {
      disposePromise ??= scope.dispose(new Error('Application shutdown'));
      return disposePromise;
    },
  };
}
