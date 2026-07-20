import { describe, expect, it } from 'vitest';
import { selectRetainedChatStore } from './select-retained-chat-store';

describe('selectRetainedChatStore', () => {
  it('keeps the active chat when another tab kind becomes active', () => {
    const chat = { id: 'chat' };
    expect(selectRetainedChatStore([chat], null, chat)).toBe(chat);
  });

  it('switches to a newly active chat', () => {
    const first = { id: 'first' };
    const second = { id: 'second' };
    expect(selectRetainedChatStore([first, second], second, first)).toBe(second);
  });

  it('releases a retained chat after its tab closes', () => {
    const closed = { id: 'closed' };
    expect(selectRetainedChatStore([], null, closed)).toBeNull();
  });
});
