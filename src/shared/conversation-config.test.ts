import { describe, expect, it } from 'vitest';
import {
  isOpenCodeProviderSessionId,
  parseConversationConfig,
  serializeConversationConfig,
} from './conversation-config';

describe('parseConversationConfig', () => {
  it('parses autoApprove and providerSessionId', () => {
    expect(
      parseConversationConfig(JSON.stringify({ autoApprove: true, providerSessionId: 'ses_abc' }))
    ).toEqual({ autoApprove: true, providerSessionId: 'ses_abc' });
  });

  it('returns empty config for invalid JSON', () => {
    expect(parseConversationConfig('not-json')).toEqual({});
  });
});

describe('isOpenCodeProviderSessionId', () => {
  it('accepts OpenCode session ids', () => {
    expect(isOpenCodeProviderSessionId('ses_0123456789abcdef')).toBe(true);
  });

  it('rejects non-OpenCode ids', () => {
    expect(isOpenCodeProviderSessionId('conv-1')).toBe(false);
    expect(isOpenCodeProviderSessionId('ses_')).toBe(false);
  });
});

describe('serializeConversationConfig', () => {
  it('round-trips known fields', () => {
    const raw = serializeConversationConfig({
      autoApprove: false,
      providerSessionId: 'ses_xyz',
    });
    expect(parseConversationConfig(raw)).toEqual({
      autoApprove: false,
      providerSessionId: 'ses_xyz',
    });
  });
});
