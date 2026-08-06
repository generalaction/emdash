import type { Logger } from '@emdash/shared/logger';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { startDevPerfInstruments } from '@emdash/shared/perf';
import { WORKER_NAME_ENV_VAR } from '../types';

export function initWorkerProcessLogging(fallbackName: string): Logger {
  const logger = initProcessLogging({
    name: process.env[WORKER_NAME_ENV_VAR] ?? fallbackName,
  });
  // Dev-only spawn/RSS reporting; a no-op unless debug logging is enabled.
  startDevPerfInstruments({ logger });
  return logger;
}
