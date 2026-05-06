import { createLogger } from '@shared/logger';

export const log = createLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
});

export type Logger = ReturnType<typeof createLogger>;
