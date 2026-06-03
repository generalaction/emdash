import { createLogger, serializeLogValue, type LogSinkEntry } from '@shared/logger';

export const log = createLogger({
  sink: (entry) => {
    const safe: LogSinkEntry = {
      level: entry.level,
      input: entry.input.map(serializeLogValue),
      source: entry.source,
    };
    window.electronAPI?.eventSend('emdash:renderer-log', safe);
  },
});
