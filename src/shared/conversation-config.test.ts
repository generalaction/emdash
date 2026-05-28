import { describe, expect, it } from 'vitest';
import {
  isDroidProviderSessionId,
  parseConversationConfig,
  serializeConversationConfig,
} from './conversation-config';

describe('conversation-config', () => {
  it('parses autoApprove, providerSessionId, and initialPrompt', () => {
    expect(
      parseConversationConfig(
        JSON.stringify({
          autoApprove: true,
          providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
          initialPrompt: 'Fix the bug',
        })
      )
    ).toEqual({
      autoApprove: true,
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
      initialPrompt: 'Fix the bug',
    });
  });

  it('returns empty config for invalid JSON', () => {
    expect(parseConversationConfig('not-json')).toEqual({});
  });

  it('round-trips through serialize', () => {
    const config = { autoApprove: false, providerSessionId: 'abc', initialPrompt: 'hello' };
    expect(parseConversationConfig(serializeConversationConfig(config))).toEqual(config);
  });

  it('validates Droid session ids as UUIDs', () => {
    expect(isDroidProviderSessionId('31477a03-961a-4451-82d4-efded56947fc')).toBe(true);
    expect(isDroidProviderSessionId('conv-1')).toBe(false);
    expect(isDroidProviderSessionId('')).toBe(false);
  });
});
