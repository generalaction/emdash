import {
  isCodexServiceTier,
  isNativeChatReasoningEffort,
  isValidNativeChatModelId,
  type CodexServiceTier,
  type NativeChatReasoningEffort,
} from '@shared/native-chat';

const DROID_SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDroidProviderSessionId(value: string): boolean {
  return DROID_SESSION_ID_PATTERN.test(value);
}

export type ConversationConfig = {
  autoApprove?: boolean;
  /** Provider-native session id (e.g. Droid UUID) for resuming the correct chat. */
  providerSessionId?: string;
  /** Initial prompt to deliver on the first spawn; cleared from config after the session starts. */
  initialPrompt?: string;
  /** Only 'native-chat' is persisted; absent means the default terminal UI. */
  uiMode?: 'native-chat';
  /** Native chat: reasoning effort override; absent means model default. */
  reasoningEffort?: NativeChatReasoningEffort;
  /** Codex native chat: model override; absent means the user's config default. */
  model?: string;
  /** Codex native chat: speed (service tier) override; absent means standard. */
  serviceTier?: CodexServiceTier;
};

export function parseConversationConfig(raw: string | null | undefined): ConversationConfig {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.autoApprove === 'boolean' ? { autoApprove: record.autoApprove } : {}),
      ...(typeof record.providerSessionId === 'string'
        ? { providerSessionId: record.providerSessionId }
        : {}),
      ...(typeof record.initialPrompt === 'string' ? { initialPrompt: record.initialPrompt } : {}),
      ...(record.uiMode === 'native-chat' ? { uiMode: 'native-chat' as const } : {}),
      ...(isNativeChatReasoningEffort(record.reasoningEffort)
        ? { reasoningEffort: record.reasoningEffort }
        : {}),
      ...(isValidNativeChatModelId(record.model) ? { model: record.model } : {}),
      ...(isCodexServiceTier(record.serviceTier) ? { serviceTier: record.serviceTier } : {}),
    };
  } catch {
    return {};
  }
}

export function serializeConversationConfig(config: ConversationConfig): string {
  return JSON.stringify(config);
}
