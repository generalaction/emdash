import { describe, expect, it } from 'vitest';
import {
  isDroidProviderSessionId,
  parseConversationConfig,
  serializeConversationConfig,
} from './conversation-config';

describe('conversation-config', () => {
  it('parses autoApprove and providerSessionId', () => {
    expect(
      parseConversationConfig(
        JSON.stringify({
          autoApprove: true,
          providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
        })
      )
    ).toEqual({
      autoApprove: true,
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
    });
  });

  it('returns empty config for invalid JSON', () => {
    expect(parseConversationConfig('not-json')).toEqual({});
  });

  it('round-trips through serialize', () => {
    const config = { autoApprove: false, providerSessionId: 'abc' };
    expect(parseConversationConfig(serializeConversationConfig(config))).toEqual(config);
  });

  it('parses uiMode only when it is native-chat', () => {
    expect(parseConversationConfig(JSON.stringify({ uiMode: 'native-chat' }))).toEqual({
      uiMode: 'native-chat',
    });
    expect(parseConversationConfig(JSON.stringify({ uiMode: 'terminal' }))).toEqual({});
    expect(parseConversationConfig(JSON.stringify({ uiMode: 'bogus' }))).toEqual({});
  });

  it('round-trips uiMode through serialize', () => {
    const config = { autoApprove: true, uiMode: 'native-chat' as const };
    expect(parseConversationConfig(serializeConversationConfig(config))).toEqual(config);
  });

  it('parses model and reasoningEffort with validation', () => {
    expect(
      parseConversationConfig(JSON.stringify({ model: 'gpt-5.5-codex', reasoningEffort: 'high' }))
    ).toEqual({ model: 'gpt-5.5-codex', reasoningEffort: 'high' });
    expect(
      parseConversationConfig(JSON.stringify({ model: 'opus', reasoningEffort: 'max' }))
    ).toEqual({ model: 'opus', reasoningEffort: 'max' });
    expect(parseConversationConfig(JSON.stringify({ model: 'bad model!' }))).toEqual({});
    expect(parseConversationConfig(JSON.stringify({ reasoningEffort: 'turbo' }))).toEqual({});
  });

  it('validates Droid session ids as UUIDs', () => {
    expect(isDroidProviderSessionId('31477a03-961a-4451-82d4-efded56947fc')).toBe(true);
    expect(isDroidProviderSessionId('conv-1')).toBe(false);
    expect(isDroidProviderSessionId('')).toBe(false);
  });
});
