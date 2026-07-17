import {
  isLevelEnabled,
  prepareFields,
  resolveLogLevel,
  type LogLevel,
} from '@emdash/shared/logger';
import { getDesktopWireClient } from '../lib/runtime/desktop-wire-client';

const level = resolveLogLevel({ envLevel: import.meta.env.VITE_LOG_LEVEL });

function emit(target: LogLevel, input: unknown[]): void {
  if (target !== 'error' && !isLevelEnabled(target, level)) return;
  // eslint-disable-next-line no-console
  console[target](...input);
  void getDesktopWireClient()
    .then((client) =>
      client.host.writeRendererLog({
        level: target,
        source: 'renderer',
        input: input.map((value) => prepareFields(value)),
      })
    )
    .catch(() => undefined);
}

export const log = {
  level,
  debug: (...input: unknown[]) => emit('debug', input),
  info: (...input: unknown[]) => emit('info', input),
  warn: (...input: unknown[]) => emit('warn', input),
  error: (...input: unknown[]) => emit('error', input),
};
