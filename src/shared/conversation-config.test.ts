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

  it('ignores legacy initialPrompt config because prompts live in the timeline', () => {
    expect(parseConversationConfig(JSON.stringify({ initialPrompt: 'Fix the bug' }))).toEqual({});
  });

  it('round-trips through serialize', () => {
    const config = { autoApprove: false, providerSessionId: 'abc' };
    expect(parseConversationConfig(serializeConversationConfig(config))).toEqual(config);
  });

  it('validates Droid session ids as UUIDs', () => {
    expect(isDroidProviderSessionId('31477a03-961a-4451-82d4-efded56947fc')).toBe(true);
    expect(isDroidProviderSessionId('conv-1')).toBe(false);
    expect(isDroidProviderSessionId('')).toBe(false);
  });
});
