export type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export function parseLogLevel(value: string | undefined): Level | undefined {
  if (!value) return undefined;
  const candidate = value.trim().toLowerCase();
  if (candidate in ORDER) return candidate as Level;
  return undefined;
}

export function resolveLogLevel(args?: { envLevel?: string; debugFlag?: boolean }): Level {
  return parseLogLevel(args?.envLevel) ?? (args?.debugFlag ? 'debug' : undefined) ?? 'warn';
}

export function createLogger(args?: { envLevel?: string; debugFlag?: boolean }) {
  const level = resolveLogLevel({
    // @ts-expect-error - VITE_LOG_LEVEL is not typed
    envLevel: args?.envLevel ?? import.meta.env.VITE_LOG_LEVEL,
    debugFlag: args?.debugFlag,
  });

  function enabled(target: Level): boolean {
    return ORDER[target] >= ORDER[level];
  }

  return {
    level,
    debug: (...input: unknown[]) => {
      if (enabled('debug')) console.debug(...input);
    },
    info: (...input: unknown[]) => {
      if (enabled('info')) console.info(...input);
    },
    warn: (...input: unknown[]) => {
      if (enabled('warn')) console.warn(...input);
    },
    error: (...input: unknown[]) => {
      console.error(...input);
    },
  };
}
