import { describe, expect, it } from 'vitest';
import {
  getConversationTabLabel,
  planConversationTitleUpdates,
} from '../../renderer/lib/conversationTabTitles';

describe('conversationTabTitles', () => {
  it('converts legacy duplicate titles into stable numbered labels', () => {
    const updates = planConversationTitleUpdates([
      {
        id: 'one',
        provider: 'claude',
        title: 'Default Conversation',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
      {
        id: 'two',
        provider: 'claude',
        title: 'Chat 1741946400000',
        createdAt: '2026-03-14T10:01:00.000Z',
      },
    ]);

    expect(updates).toEqual([
      { id: 'one', title: 'Claude Code 1' },
      { id: 'two', title: 'Claude Code 2' },
    ]);
  });

  it('keeps an existing numbered label stable after earlier tabs are gone', () => {
    const updates = planConversationTitleUpdates([
      {
        id: 'two',
        provider: 'claude',
        title: 'Claude Code 2',
        createdAt: '2026-03-14T10:01:00.000Z',
      },
    ]);

    expect(updates).toEqual([]);
    expect(
      getConversationTabLabel({
        provider: 'claude',
        title: 'Claude Code 2',
      })
    ).toBe('Claude Code 2');
  });

  it('continues numbering from the highest existing label instead of filling gaps', () => {
    const updates = planConversationTitleUpdates([
      {
        id: 'two',
        provider: 'claude',
        title: 'Claude Code 2',
        createdAt: '2026-03-14T10:01:00.000Z',
      },
      {
        id: 'three',
        provider: 'claude',
        title: 'Chat 1741946460000',
        createdAt: '2026-03-14T10:02:00.000Z',
      },
    ]);

    expect(updates).toEqual([{ id: 'three', title: 'Claude Code 3' }]);
  });

  it('promotes an existing single auto-managed title to index 1 when a duplicate is added', () => {
    const updates = planConversationTitleUpdates([
      {
        id: 'one',
        provider: 'codex',
        title: 'Codex',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
      {
        id: 'two',
        provider: 'codex',
        title: 'Chat 1741946400000',
        createdAt: '2026-03-14T10:01:00.000Z',
      },
    ]);

    expect(updates).toEqual([
      { id: 'one', title: 'Codex 1' },
      { id: 'two', title: 'Codex 2' },
    ]);
  });

  it('uses the agent name for a single legacy tab', () => {
    const updates = planConversationTitleUpdates([
      {
        id: 'main',
        provider: 'qwen',
        title: 'Default Conversation',
        createdAt: '2026-03-14T10:00:00.000Z',
      },
    ]);

    expect(updates).toEqual([{ id: 'main', title: 'Qwen Code' }]);
    expect(
      getConversationTabLabel({
        provider: 'qwen',
        title: 'Default Conversation',
      })
    ).toBe('Qwen Code');
  });
});
