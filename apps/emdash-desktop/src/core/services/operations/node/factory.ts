import { operationStoreSqlite, SqliteOperationStore } from '@emdash/core/primitives/kernel/sqlite';
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
  databasePath: string;
  sshManager: OperationsSshManager;
  notifications: OperationsNotificationPublisher;
  definitions: OperationDefinition[];
  initiatedBy?: string;
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
  const storeHandle = operationStoreSqlite.open(deps.databasePath);
  const store = new SqliteOperationStore(storeHandle);
  const engine = new OperationsEngine({ ...deps, scope, store });
  await engine.start();

  let disposePromise: Promise<void> | undefined;
  return {
    engine,
    async dispose() {
      disposePromise ??= (async () => {
        await engine.shutdown();
        await scope.dispose(new Error('Application shutdown'));
      })();
      return disposePromise;
    },
  };
}
