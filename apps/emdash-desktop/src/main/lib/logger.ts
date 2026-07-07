import { createVariadicAdapter } from '@emdash/shared/logger';
import { createPinoLogger } from '@emdash/shared/logger/pino';
import { getLogFileDestination } from './file-logger';

const inner = createPinoLogger({
  envLevel: process.env.LOG_LEVEL,
  debugFlag: process.argv.includes('--debug-logs'),
  bindings: { source: 'main' },
  destination: getLogFileDestination(),
});

export const log = createVariadicAdapter(inner);

export type Logger = typeof log;
