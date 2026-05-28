import { describe, expect, it } from 'vitest';
import { resolveConversationUiModeSelection } from './conversation-ui-mode-selection';

describe('resolveConversationUiModeSelection', () => {
  it('returns the newly selected conversation UI mode', () => {
    expect(resolveConversationUiModeSelection('terminal', ['chat'])).toBe('chat');
    expect(resolveConversationUiModeSelection('chat', ['terminal'])).toBe('terminal');
  });

  it('ignores empty and invalid selections', () => {
    expect(resolveConversationUiModeSelection('terminal', [])).toBeNull();
    expect(resolveConversationUiModeSelection('terminal', ['terminal'])).toBeNull();
    expect(resolveConversationUiModeSelection('terminal', ['invalid'])).toBeNull();
  });
});
