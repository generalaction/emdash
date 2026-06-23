import { describe, expect, it } from 'vitest';
import { resolveConversationUiMode } from './resolve-conversation-ui-mode';

const TERMINAL = { mode: 'terminal' } as const;
const NATIVE = { mode: 'native-chat' } as const;

describe('resolveConversationUiMode', () => {
  it('defaults to terminal when the setting is terminal', () => {
    expect(
      resolveConversationUiMode({
        providerId: 'codex',
        conversationUi: TERMINAL,
        isRemoteTask: false,
      })
    ).toBe('terminal');
    expect(
      resolveConversationUiMode({
        providerId: 'claude',
        conversationUi: TERMINAL,
        isRemoteTask: false,
      })
    ).toBe('terminal');
  });

  it('uses native chat for supported providers when the setting opts in', () => {
    expect(
      resolveConversationUiMode({
        providerId: 'codex',
        conversationUi: NATIVE,
        isRemoteTask: false,
      })
    ).toBe('native-chat');
    expect(
      resolveConversationUiMode({
        providerId: 'claude',
        conversationUi: NATIVE,
        isRemoteTask: false,
      })
    ).toBe('native-chat');
    expect(
      resolveConversationUiMode({
        providerId: 'pi',
        conversationUi: NATIVE,
        isRemoteTask: false,
      })
    ).toBe('native-chat');
  });

  it('keeps providers without an adapter on the terminal', () => {
    expect(
      resolveConversationUiMode({
        providerId: 'gemini',
        conversationUi: NATIVE,
        isRemoteTask: false,
      })
    ).toBe('terminal');
  });

  it('keeps remote tasks on the terminal', () => {
    expect(
      resolveConversationUiMode({
        providerId: 'pi',
        conversationUi: NATIVE,
        isRemoteTask: true,
      })
    ).toBe('terminal');
  });
});
