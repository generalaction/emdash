import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import { app, contentTracing } from 'electron';
import type { DevPerfTraceError } from '@core/features/dev-perf/api/contract';
import type { DevPerfOperations } from '@core/features/dev-perf/node/wire-controller';
import type { DesktopRuntimes } from '@main/gateway/desktop-runtimes';
import { log } from '@main/lib/logger';

let tracingInFlight = false;

/**
 * Record a contentTracing trace for `durationMs` and write it under
 * `<userData>/traces/`. A capture already running is an expected failure —
 * traces are whole-app recordings, so overlapping captures make no sense.
 */
async function captureTrace(durationMs: number): Promise<Result<string, DevPerfTraceError>> {
  if (tracingInFlight) return err({ type: 'trace_in_progress' as const });
  tracingInFlight = true;
  try {
    const dir = join(app.getPath('userData'), 'traces');
    await mkdir(dir, { recursive: true });
    const file = join(dir, `emdash-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    await contentTracing.startRecording({
      included_categories: ['*'],
      excluded_categories: ['*-details'],
    });
    await new Promise((resolve) => setTimeout(resolve, durationMs));
    const path = await contentTracing.stopRecording(file);
    log.info('dev-perf: trace captured', { path, durationMs });
    return ok(path);
  } finally {
    tracingInFlight = false;
  }
}

export function createDevPerfOperations(runtimes: DesktopRuntimes): DevPerfOperations {
  return {
    captureTrace,
    setWorkerSpawnLogging: (enabled) => runtimes.setWorkerSpawnLogging(enabled),
  };
}
