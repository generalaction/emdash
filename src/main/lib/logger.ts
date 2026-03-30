type Level = 'debug' | 'info' | 'warn' | 'error';

type ConsoleMethod = (...args: any[]) => void;

function envLevel(): Level {
  const hasDebugFlag = process.argv.includes('--debug-logs') || process.argv.includes('--dev');
  if (hasDebugFlag) return 'debug';
  return 'warn';
}

function enabled(target: Level, current: Level): boolean {
  const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
  return order[target] >= order[current];
}

function safeConsoleCall(method: ConsoleMethod, ...args: any[]): void {
  try {
    method(...args);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'EPIPE') {
      return;
    }
    throw error;
  }
}

const current = envLevel();

export const log = {
  debug: (...args: any[]) => {
    if (enabled('debug', current)) {
      // eslint-disable-next-line no-console
      safeConsoleCall(console.debug, ...args);
    }
  },
  info: (...args: any[]) => {
    if (enabled('info', current)) {
      // eslint-disable-next-line no-console
      safeConsoleCall(console.info, ...args);
    }
  },
  warn: (...args: any[]) => {
    if (enabled('warn', current)) {
      // eslint-disable-next-line no-console
      safeConsoleCall(console.warn, ...args);
    }
  },
  error: (...args: any[]) => {
    // eslint-disable-next-line no-console
    safeConsoleCall(console.error, ...args);
  },
};
