import type { AppSettings } from '@shared/app-settings';
import type { ConversationConfig } from '@shared/conversation-config';
import type { NativeChatProviderId } from '@shared/conversation-ui';

type NativeChatProviderDefaults = NonNullable<
  AppSettings['nativeChatDefaults'][NativeChatProviderId]
>;

/**
 * Seed a new native-chat conversation's config with the provider's last-used
 * model/reasoning/speed. Explicitly set fields win over defaults.
 */
export function applyNativeChatDefaults(
  config: ConversationConfig,
  defaults: NativeChatProviderDefaults | undefined
): void {
  if (!defaults) return;
  if (defaults.model && config.model === undefined) config.model = defaults.model;
  if (defaults.reasoningEffort && config.reasoningEffort === undefined) {
    config.reasoningEffort = defaults.reasoningEffort;
  }
  if (defaults.serviceTier && config.serviceTier === undefined) {
    config.serviceTier = defaults.serviceTier;
  }
}
