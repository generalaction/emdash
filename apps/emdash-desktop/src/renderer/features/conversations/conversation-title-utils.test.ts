import { asAgentProviderId } from '@emdash/plugins/agents/types';
import { describe, expect, it } from 'vitest';
import {
  formatConversationTitleForDisplay,
  matchesConversationSearch,
  nextDefaultConversationTitle,
} from './conversation-title-utils';

const claude = asAgentProviderId('claude');
const codex = asAgentProviderId('codex');

describe('formatConversationTitleForDisplay', () => {
  it('capitalizes the provider name in a default-numbered title', () => {
    expect(formatConversationTitleForDisplay(claude, 'claude (2)')).toBe('Claude (2)');
  });

  it('leaves a custom (renamed) title untouched', () => {
    expect(formatConversationTitleForDisplay(claude, 'Fix login bug')).toBe('Fix login bug');
  });
});

describe('matchesConversationSearch', () => {
  it('matches case-insensitively against the display title, not the raw title', () => {
    // raw title is lowercase ("claude (2)") but the query should match what
    // the user actually sees rendered ("Claude (2)").
    expect(matchesConversationSearch(claude, 'claude (2)', 'Claude')).toBe(true);
    expect(matchesConversationSearch(claude, 'claude (2)', 'CLAUDE')).toBe(true);
  });

  it('matches a substring, not just a prefix', () => {
    expect(matchesConversationSearch(claude, 'Fix login bug', 'login')).toBe(true);
  });

  it('does not match unrelated text', () => {
    expect(matchesConversationSearch(claude, 'Fix login bug', 'checkout')).toBe(false);
  });

  it('treats an empty or whitespace-only query as matching everything', () => {
    expect(matchesConversationSearch(claude, 'Fix login bug', '')).toBe(true);
    expect(matchesConversationSearch(claude, 'Fix login bug', '   ')).toBe(true);
  });
});

describe('nextDefaultConversationTitle', () => {
  it('returns "(1)" when there are no existing default-named conversations', () => {
    expect(nextDefaultConversationTitle(claude, [])).toBe('Claude (1)');
  });

  it('fills the lowest unused index', () => {
    const conversations = [
      { providerId: claude, title: 'Claude (1)' },
      { providerId: claude, title: 'Claude (3)' },
    ];
    expect(nextDefaultConversationTitle(claude, conversations)).toBe('Claude (2)');
  });

  it('ignores conversations from other providers', () => {
    const conversations = [{ providerId: codex, title: 'Codex (1)' }];
    expect(nextDefaultConversationTitle(claude, conversations)).toBe('Claude (1)');
  });
});
