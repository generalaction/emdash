import type { Logger } from '@agent/shared/logger';
import { initProcessLogging } from '@agent/shared/logger/node';
import { startDevPerfInstruments } from '@agent/shared/perf';
import { WORKER_NAME_ENV_VAR } from '../types';
import { installWorkerVitals } from './vitals';

export function initWorkerProcessLogging(fallbackName: string): Logger {
  const logger = initProcessLogging({
    name: process.env[WORKER_NAME_ENV_VAR] ?? fallbackName,
  });
  // Dev-only spawn/RSS reporting; a no-op unless debug logging is enabled.
  startDevPerfInstruments({ logger });
  // Telemetry vitals + verbose spawn logging: inert until the host sends a
  // control message; no timers or instruments are created before then.
  installWorkerVitals({ logger });
  return logger;
}
