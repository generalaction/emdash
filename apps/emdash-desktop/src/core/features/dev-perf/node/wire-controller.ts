import { map, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { setVerboseSpawnLogging } from '@emdash/shared/perf';
import { createController, type Controller } from '@emdash/wire/rpc';
import { devPerfContract, type DevPerfTraceError } from '../api';
import { PROCESS_SNAPSHOT_SUPPORTED, snapshotProcessTree } from './process-snapshot';

export type DevPerfOperations = {
  /** Record a contentTracing trace and return the file path it was written to. */
  captureTrace(durationMs: number): Promise<Result<string, DevPerfTraceError>>;
  /** Toggle verbose per-spawn logging in every worker process. */
  setWorkerSpawnLogging(enabled: boolean): void;
};

const DEFAULT_TRACE_DURATION_MS = 10_000;
const MAX_TRACE_DURATION_MS = 120_000;

export function createDevPerfWireController(
  operations: DevPerfOperations,
  logger: Logger
): Controller {
  let verboseSpawnLogging = false;

  return createController(devPerfContract, {
    processSnapshot: async () => ({
      supported: PROCESS_SNAPSHOT_SUPPORTED,
      processes: await snapshotProcessTree(),
    }),
    captureTrace: async ({ durationMs }) => {
      const clamped = Math.min(
        MAX_TRACE_DURATION_MS,
        Math.max(1_000, durationMs ?? DEFAULT_TRACE_DURATION_MS)
      );
      return map(await operations.captureTrace(clamped), (path) => ({ path }));
    },
    setVerboseSpawnLogging: ({ enabled }) => {
      verboseSpawnLogging = enabled;
      setVerboseSpawnLogging(logger, enabled);
      operations.setWorkerSpawnLogging(enabled);
      return { enabled };
    },
    getVerboseSpawnLogging: () => ({ enabled: verboseSpawnLogging }),
  });
}
