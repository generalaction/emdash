import { normalizeTerminalHttpUrl } from '@shared/terminal-url';

export function normalizeExternalHttpUrl(value: string): string {
  return normalizeTerminalHttpUrl(value);
}
