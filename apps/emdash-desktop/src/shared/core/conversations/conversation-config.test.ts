import { describe, expect, it } from 'vitest';
import { conversationConfig, isDroidProviderSessionId } from './conversation-config';

describe('conversation-config', () => {
  it('parses autoApprove', () => {
    const result = conversationConfig.safeParse({ autoApprove: true });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({ autoApprove: true });
    }
  });

  it('returns invalid for non-object input', () => {
    expect(conversationConfig.safeParse('not-json')).toMatchObject({ status: 'invalid' });
    expect(conversationConfig.safeParse(null)).toMatchObject({ status: 'invalid' });
  });

  it('round-trips through parseJson and serialize', () => {
    const config = { autoApprove: false };
    const json = conversationConfig.serialize(config);
    expect(conversationConfig.parseJson(json)).toEqual(config);
  });

  it('parseJson returns null for invalid JSON', () => {
    expect(conversationConfig.parseJson('not-json')).toBeNull();
  });

  it('parseJson returns null for null input', () => {
    expect(conversationConfig.parseJson(null)).toBeNull();
  });

  it('validates Droid session ids as UUIDs', () => {
    expect(isDroidProviderSessionId('31477a03-961a-4451-82d4-efded56947fc')).toBe(true);
    expect(isDroidProviderSessionId('conv-1')).toBe(false);
    expect(isDroidProviderSessionId('')).toBe(false);
  });
});
