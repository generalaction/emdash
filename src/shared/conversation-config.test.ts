import { describe, expect, it } from 'vitest';
import {
  isDroidProviderSessionId,
  parseConversationConfig,
  serializeConversationConfig,
} from './conversation-config';

describe('conversation-config', () => {
  it('parses runtime, autoApprove, and providerSessionId', () => {
    expect(
      parseConversationConfig(
        JSON.stringify({
          autoApprove: true,
          runtime: 'acp',
          providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
        })
      )
    ).toEqual({
      autoApprove: true,
      runtime: 'acp',
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
    });
  });

  it('ignores unknown runtime values', () => {
    expect(parseConversationConfig(JSON.stringify({ runtime: 'chat' }))).toEqual({});
  });

  it('returns empty config for invalid JSON', () => {
    expect(parseConversationConfig('not-json')).toEqual({});
  });

  it('round-trips through serialize', () => {
    const config = { autoApprove: false, runtime: 'terminal' as const, providerSessionId: 'abc' };
    expect(parseConversationConfig(serializeConversationConfig(config))).toEqual(config);
  });

  it('validates Droid session ids as UUIDs', () => {
    expect(isDroidProviderSessionId('31477a03-961a-4451-82d4-efded56947fc')).toBe(true);
    expect(isDroidProviderSessionId('conv-1')).toBe(false);
    expect(isDroidProviderSessionId('')).toBe(false);
  });
});
