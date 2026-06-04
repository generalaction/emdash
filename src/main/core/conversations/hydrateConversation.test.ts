import { describe, expect, it, vi } from 'vitest';
import { serializeConversationConfig } from '@shared/conversation-config';
import { shouldHydrateAsFirstSpawn } from './hydration-mode';

describe('shouldHydrateAsFirstSpawn', () => {
  it('treats recent pending initial-prompt rows as first spawn', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-03T08:00:00.000Z'));

      expect(
        shouldHydrateAsFirstSpawn({
          sessionId: null,
          config: serializeConversationConfig({ initialPrompt: 'Fix the bug' }),
          createdAt: '2026-06-03T07:59:00.000Z',
        })
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parses SQLite CURRENT_TIMESTAMP values as UTC for pending initial prompts', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-03T08:00:00.000Z'));

      expect(
        shouldHydrateAsFirstSpawn({
          sessionId: null,
          config: serializeConversationConfig({ initialPrompt: 'Fix the bug' }),
          createdAt: '2026-06-03 07:59:00',
        })
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats legacy null-session rows as resume instead of first spawn', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-06-03T08:00:00.000Z'));

      expect(
        shouldHydrateAsFirstSpawn({
          sessionId: null,
          config: serializeConversationConfig({ initialPrompt: 'Fix the bug' }),
          createdAt: '2026-06-03T07:00:00.000Z',
        })
      ).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('treats null-session rows without an initial prompt as resume', () => {
    expect(
      shouldHydrateAsFirstSpawn({
        sessionId: null,
        config: null,
        createdAt: new Date().toISOString(),
      })
    ).toBe(false);
  });

  it('treats rows with a session id as resume', () => {
    expect(
      shouldHydrateAsFirstSpawn({
        sessionId: 'conversation-1',
        config: serializeConversationConfig({ initialPrompt: 'Fix the bug' }),
        createdAt: new Date().toISOString(),
      })
    ).toBe(false);
  });
});
