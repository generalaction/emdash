import type { Logger } from '@emdash/shared/logger';
import { initProcessLogging } from '@emdash/shared/logger/node';
import { WORKER_NAME_ENV_VAR } from '../types';

export function initWorkerProcessLogging(fallbackName: string): Logger {
  return initProcessLogging({
    name: process.env[WORKER_NAME_ENV_VAR] ?? fallbackName,
  });
}
