import { isValidConversationRuntime, type ConversationRuntimeKind } from './conversation-runtime';

const DROID_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDroidProviderSessionId(value: string): boolean {
  return DROID_SESSION_ID_PATTERN.test(value);
}

export type ConversationConfig = {
  autoApprove?: boolean;
  runtime?: ConversationRuntimeKind;
  /** Provider-native session id (e.g. Droid UUID) for resuming the correct chat. */
  providerSessionId?: string;
  /** Initial prompt to deliver on the first spawn; cleared from config after the session starts. */
  initialPrompt?: string;
};

export function parseConversationConfig(raw: string | null | undefined): ConversationConfig {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.autoApprove === 'boolean' ? { autoApprove: record.autoApprove } : {}),
      ...(isValidConversationRuntime(record.runtime) ? { runtime: record.runtime } : {}),
      ...(typeof record.providerSessionId === 'string'
        ? { providerSessionId: record.providerSessionId }
        : {}),
      ...(typeof record.initialPrompt === 'string' ? { initialPrompt: record.initialPrompt } : {}),
    };
  } catch {
    return {};
  }
}

export function serializeConversationConfig(config: ConversationConfig): string {
  return JSON.stringify(config);
}
