export type Level = 'debug' | 'info' | 'warn' | 'error';

export type LogSinkEntry = {
  level: Level;
  input: unknown[];
  source?: string;
};

export type LogSink = (entry: LogSinkEntry) => void;

export function serializeLogValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();

  if (value && typeof value === 'object') {
    try {
      return JSON.parse(stringifyLogValue(value));
    } catch {
      return String(value);
    }
  }

  return value;
}

export function stringifyLogValue(value: unknown) {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, nestedValue: unknown) => {
    if (nestedValue instanceof Error) return serializeLogValue(nestedValue);
    if (typeof nestedValue === 'bigint') return nestedValue.toString();
    if (typeof nestedValue === 'function') return `[Function ${nestedValue.name || 'anonymous'}]`;
    if (typeof nestedValue === 'symbol') return nestedValue.toString();
    if (nestedValue && typeof nestedValue === 'object') {
      if (seen.has(nestedValue)) return '[Circular]';
      seen.add(nestedValue);
    }
    return nestedValue;
  });
}

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

export function createLogger(args?: { envLevel?: string; debugFlag?: boolean; sink?: LogSink }) {
  const level = resolveLogLevel({
    envLevel: args?.envLevel ?? import.meta.env?.VITE_LOG_LEVEL,
    debugFlag: args?.debugFlag,
  });

  function enabled(target: Level): boolean {
    return ORDER[target] >= ORDER[level];
  }

  function emit(target: Level, writer: (...input: unknown[]) => void, input: unknown[]) {
    if (target !== 'error' && !enabled(target)) return;
    writer(...input);
    if (!args?.sink) return;
    try {
      args.sink({ level: target, input });
    } catch {
      // Sink failures must never break the caller.
    }
  }

  return {
    level,
    debug: (...input: unknown[]) => emit('debug', console.debug, input),
    info: (...input: unknown[]) => emit('info', console.info, input),
    warn: (...input: unknown[]) => emit('warn', console.warn, input),
    error: (...input: unknown[]) => emit('error', console.error, input),
  };
}
