import { describe, expect, it } from 'vitest';
import { conversationConfig, isDroidProviderSessionId } from './conversation-config';

describe('conversation-config', () => {
  it('parses autoApprove and providerSessionId', () => {
    const result = conversationConfig.safeParse({
      autoApprove: true,
      providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({
        autoApprove: true,
        providerSessionId: '31477a03-961a-4451-82d4-efded56947fc',
      });
    }
  });

  it('returns invalid for non-object input', () => {
    expect(conversationConfig.safeParse('not-json')).toMatchObject({ status: 'invalid' });
    expect(conversationConfig.safeParse(null)).toMatchObject({ status: 'invalid' });
  });

  it('round-trips through parseJson and serialize', () => {
    const config = { autoApprove: false, providerSessionId: 'abc' };
    const json = conversationConfig.serialize(config);
    expect(conversationConfig.parseJson(json)).toEqual(config);
  });

  it('parses uiMode only when it is native-chat', () => {
    expect(conversationConfig.parseJson(JSON.stringify({ uiMode: 'native-chat' }))).toEqual({
      uiMode: 'native-chat',
    });
    expect(conversationConfig.parseJson(JSON.stringify({ uiMode: 'terminal' }))).toBeNull();
    expect(conversationConfig.parseJson(JSON.stringify({ uiMode: 'bogus' }))).toBeNull();
  });

  it('parses model, reasoning effort, and service tier with validation', () => {
    expect(
      conversationConfig.parseJson(
        JSON.stringify({
          model: 'openai/gpt-4o',
          reasoningEffort: 'high',
          serviceTier: 'priority',
        })
      )
    ).toEqual({ model: 'openai/gpt-4o', reasoningEffort: 'high', serviceTier: 'priority' });
    expect(conversationConfig.parseJson(JSON.stringify({ model: 'bad model!' }))).toBeNull();
    expect(conversationConfig.parseJson(JSON.stringify({ reasoningEffort: 'turbo' }))).toBeNull();
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
