/**
 * Minimal structural subset of a pino-style logger.
 *
 * Any `pino` instance satisfies this interface (pino's `LogFn` includes the
 * `(msg: string, ...args) => void` overload), as do most console-like loggers.
 * Shared modules depend on this shape instead of a concrete logging library.
 */
export interface Logger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

/** No-op logger for tests or contexts without a log sink. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/** Console-backed logger used as the shared default. */
export const consoleLogger: Logger = {
  debug: (message, ...args) => console.debug(message, ...args),
  info: (message, ...args) => console.info(message, ...args),
  warn: (message, ...args) => console.warn(message, ...args),
  error: (message, ...args) => console.error(message, ...args),
};
