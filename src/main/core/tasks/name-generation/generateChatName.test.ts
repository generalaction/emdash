import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateChatName } from '@shared/tasks';

describe('generateChatName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a chat-prefixed name with the current month and day', () => {
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('May');
    const name = generateChatName(new Date('2026-05-27T12:00:00Z'));
    expect(name).toBe('chat-may-27');
  });

  it('returns different names on different days', () => {
    vi.spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValueOnce('May')
      .mockReturnValueOnce('Jun');
    const may = generateChatName(new Date('2026-05-27T12:00:00Z'));
    const june = generateChatName(new Date('2026-06-01T12:00:00Z'));
    expect(may).not.toBe(june);
  });
});
