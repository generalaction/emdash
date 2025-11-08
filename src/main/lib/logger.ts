type Level = 'debug' | 'info' | 'warn' | 'error';

function envLevel(): Level {
  const hasDebugFlag = process.argv.includes('--debug-logs') || process.argv.includes('--dev');
  if (hasDebugFlag) return 'debug';
  return 'warn';
}

function enabled(target: Level, current: Level): boolean {
  const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[target] >= order[current];
}

const current = envLevel();

export const log = {
  debug: (...args: any[]) => {
    if (enabled('debug', current)) {
      // eslint-disable-next-line no-console
      console.debug(...args);
    }
  },
  info: (...args: any[]) => {
    if (enabled('info', current)) {
      // eslint-disable-next-line no-console
      console.info(...args);
    }
  },
  warn: (...args: any[]) => {
    if (enabled('warn', current)) {
      // eslint-disable-next-line no-console
      console.warn(...args);
    }
  },
  error: (...args: any[]) => {
    // eslint-disable-next-line no-console
    console.error(...args);
  },
};
