import { normalizeTerminalHttpUrl } from '@emdash/core/services/preview-detection/api';

export function normalizeExternalHttpUrl(value: string): string {
  return normalizeTerminalHttpUrl(value);
}
