import { describe, expect, it } from 'vitest';
import type { ConversationConfig } from '@shared/core/conversations/conversation-config';
import { applyNativeChatDefaults } from './apply-native-chat-defaults';

describe('applyNativeChatDefaults', () => {
  it('seeds model, reasoning, and speed from the provider defaults', () => {
    const config: ConversationConfig = { uiMode: 'native-chat' };
    applyNativeChatDefaults(config, {
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      serviceTier: 'priority',
    });
    expect(config).toEqual({
      uiMode: 'native-chat',
      model: 'gpt-5.4-mini',
      reasoningEffort: 'xhigh',
      serviceTier: 'priority',
    });
  });

  it('never overwrites explicitly set fields', () => {
    const config: ConversationConfig = { model: 'gpt-5.5', reasoningEffort: 'low' };
    applyNativeChatDefaults(config, { model: 'gpt-5.4', reasoningEffort: 'high' });
    expect(config.model).toBe('gpt-5.5');
    expect(config.reasoningEffort).toBe('low');
  });

  it('is a no-op without defaults', () => {
    const config: ConversationConfig = {};
    applyNativeChatDefaults(config, undefined);
    applyNativeChatDefaults(config, {});
    expect(config).toEqual({});
  });
});
