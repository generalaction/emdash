import { describe, expect, it } from 'vitest';
import { nextDefaultConversationTitle } from '@renderer/features/tasks/conversations/conversation-title-utils';

describe('nextDefaultConversationTitle', () => {
  it('fills the smallest missing index for a provider', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'codex', title: 'codex (1)' },
      { providerId: 'codex', title: 'codex (3)' },
    ]);

    expect(title).toBe('codex (2)');
  });

  it('appends when there are no gaps', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'codex', title: 'codex (1)' },
      { providerId: 'codex', title: 'codex (2)' },
      { providerId: 'codex', title: 'codex (3)' },
    ]);

    expect(title).toBe('codex (4)');
  });

  it('ignores other providers and non-default titles', () => {
    const title = nextDefaultConversationTitle('codex', [
      { providerId: 'claude', title: 'claude (1)' },
      { providerId: 'codex', title: 'release-triage' },
      { providerId: 'codex', title: 'codex (2)' },
    ]);

    expect(title).toBe('codex (1)');
  });
});
