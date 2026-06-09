import { createLogger } from '@shared/logger';
import { writeLogEntry } from './file-logger';

export const log = createLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
  sink: writeLogEntry,
});

export type Logger = ReturnType<typeof createLogger>;
