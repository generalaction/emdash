import { describe, expect, it } from 'vitest';
import { resolveConversationSurface } from '@renderer/features/tasks/conversations/conversation-surface';

describe('resolveConversationSurface', () => {
  it('defaults to the terminal when there is no conversation', () => {
    expect(resolveConversationSurface(undefined)).toBe('terminal');
  });

  it('keeps codex conversations without a uiMode on the terminal', () => {
    expect(resolveConversationSurface({ providerId: 'codex' })).toBe('terminal');
    expect(resolveConversationSurface({ providerId: 'codex', uiMode: 'terminal' })).toBe(
      'terminal'
    );
  });

  it('routes native-chat conversations of adapter providers to the chat surface', () => {
    expect(resolveConversationSurface({ providerId: 'codex', uiMode: 'native-chat' })).toBe(
      'native-chat'
    );
    expect(resolveConversationSurface({ providerId: 'claude', uiMode: 'native-chat' })).toBe(
      'native-chat'
    );
    expect(resolveConversationSurface({ providerId: 'pi', uiMode: 'native-chat' })).toBe(
      'native-chat'
    );
  });

  it('never routes providers without an adapter to native chat', () => {
    expect(resolveConversationSurface({ providerId: 'gemini', uiMode: 'native-chat' })).toBe(
      'terminal'
    );
    expect(resolveConversationSurface({ providerId: 'gemini' })).toBe('terminal');
  });
});
