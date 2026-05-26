import { describe, expect, it, vi } from 'vitest';
import { extractCodexProviderSessionId } from './codex-session-start';

vi.mock('@main/core/conversations/set-provider-session-id', () => ({
  setProviderSessionId: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('./event-enricher', () => ({
  enrichEvent: vi.fn(),
}));

describe('extractCodexProviderSessionId', () => {
  it('prefers session_id from Codex hook payloads', () => {
    expect(
      extractCodexProviderSessionId({
        session_id: '019c95f6-cd96-7812-ba15-574286674599',
        resource_id: 'other',
      })
    ).toBe('019c95f6-cd96-7812-ba15-574286674599');
  });

  it('falls back to resource_id aliases', () => {
    expect(extractCodexProviderSessionId({ resourceId: 'thread-1' })).toBe('thread-1');
    expect(extractCodexProviderSessionId({ resource_id: 'thread-2' })).toBe('thread-2');
  });

  it('returns undefined when no session id is present', () => {
    expect(extractCodexProviderSessionId({ type: 'task_started' })).toBeUndefined();
  });
});
