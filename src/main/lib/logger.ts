import { createLogger } from '@shared/logger';

export const log = createLogger({
  debugFlag: process.argv.includes('--debug-logs'),
});
