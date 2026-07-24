import { normalizeTerminalHttpUrl } from '@emdash/core/runtimes/terminals/api';

export function normalizeExternalHttpUrl(value: string): string {
  return normalizeTerminalHttpUrl(value);
}
