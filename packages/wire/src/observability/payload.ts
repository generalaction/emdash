import { prepareFields, redactAll, stringifyLogValue } from '@emdash/shared/logger';

export type PayloadSummaryOptions = {
  maxPayloadLength?: number;
};

const DEFAULT_MAX_PAYLOAD_LENGTH = 8_192;

export function summarizePayload(
  value: unknown,
  options: PayloadSummaryOptions = {}
): string | undefined {
  if (value === undefined) return undefined;
  const maxPayloadLength = options.maxPayloadLength ?? DEFAULT_MAX_PAYLOAD_LENGTH;
  const serialized = redactAll(stringifyLogValue(prepareFields(value)));
  if (serialized.length <= maxPayloadLength) return serialized;
  return `${serialized.slice(0, maxPayloadLength)}... [truncated ${serialized.length - maxPayloadLength} chars]`;
}
