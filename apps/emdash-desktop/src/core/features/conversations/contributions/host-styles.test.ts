import { describe, expect, it } from 'vitest';
import { conversationsHostStylesContribution } from './host-styles';

const EXPECTED_CHAT_HOST_PROPERTIES = [
  '--chat-bg',
  '--chat-bg-1',
  '--chat-bg-2',
  '--chat-bg-3',
  '--chat-border',
  '--chat-bubble-user',
  '--chat-bubble-user-fg',
  '--chat-code-bg',
  '--chat-code-inline-bg',
  '--chat-diff-added',
  '--chat-diff-deleted',
  '--chat-diff-modified',
  '--chat-fg',
  '--chat-fg-body',
  '--chat-fg-error',
  '--chat-fg-muted',
  '--chat-fg-passive',
  '--chat-font-mono',
  '--chat-font-sans',
  '--chat-link',
  '--chat-mention-bg',
  '--chat-mention-chip-bg',
  '--chat-mention-chip-fg',
  '--chat-mention-custom-bg',
  '--chat-mention-custom-fg',
  '--chat-mention-fg',
  '--chat-mention-file-bg',
  '--chat-mention-file-fg',
  '--chat-mention-issue-bg',
  '--chat-mention-issue-fg',
  '--chat-mention-symbol-bg',
  '--chat-mention-symbol-fg',
  '--chat-plan-active',
  '--chat-plan-done',
  '--chat-radius-full',
  '--chat-radius-lg',
  '--chat-radius-md',
  '--chat-radius-sm',
  '--chat-radius-xl',
  '--chat-table-header-bg',
  '--chat-user-card-bg',
  '--chat-user-card-border',
  '--chat-user-card-border-hover',
] as const;

describe('conversations Host Styling Adapter contribution', () => {
  it('owns the complete Chat UI Token map at the desktop feature seam', () => {
    const exports = conversationsHostStylesContribution.exports as {
      chatHostAdapterClassName: string;
      chatHostProperties?: Readonly<Record<string, string>>;
      chatHostTokenValues?: Readonly<Record<string, string>>;
    };

    expect(conversationsHostStylesContribution.id).toBe('chat-ui-theme');
    expect(exports.chatHostAdapterClassName).not.toBe('');
    expect(Object.values(exports.chatHostProperties ?? {}).sort()).toEqual(
      [...EXPECTED_CHAT_HOST_PROPERTIES].sort()
    );
    expect(Object.keys(exports.chatHostTokenValues ?? {}).sort()).toEqual(
      [...EXPECTED_CHAT_HOST_PROPERTIES].sort()
    );
    expect(
      Object.values(exports.chatHostTokenValues ?? {}).every(
        (value) => value.startsWith('var(--em-') && value.endsWith(')')
      )
    ).toBe(true);
  });
});
