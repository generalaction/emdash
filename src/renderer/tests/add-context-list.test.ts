import { describe, expect, it } from 'vitest';
import { buildAddContextListEntries } from '@renderer/features/tasks/conversations/add-context-list';
import type { ContextAction } from '@renderer/features/tasks/conversations/context-actions';

describe('buildAddContextListEntries', () => {
  const folders = [
    { id: 'reviews', title: 'Reviews' },
    { id: 'bugs', title: 'Bugs' },
  ];

  const actions: ContextAction[] = [
    {
      id: 'prompt:free',
      kind: 'prompt',
      prompt: { id: 'free', title: 'Free prompt', prompt: 'Do it.' },
    },
    {
      id: 'prompt:in-folder',
      kind: 'prompt',
      prompt: {
        id: 'in-folder',
        title: 'Foldered',
        prompt: 'Review code.',
        folderId: 'reviews',
      },
      folder: folders[0],
    },
  ];

  it('lists folders first, then unfiled prompts at the root', () => {
    const entries = buildAddContextListEntries({
      actions,
      folders,
      browseFolderId: null,
      query: '',
    });

    expect(entries.map((entry) => entry.kind)).toEqual(['folder', 'folder', 'action']);
    expect(entries[0]).toMatchObject({ kind: 'folder', id: 'folder:reviews' });
    expect(entries[2]).toMatchObject({ kind: 'action', id: 'prompt:free' });
  });

  it('shows only prompts from the active folder when browsing', () => {
    const entries = buildAddContextListEntries({
      actions,
      folders,
      browseFolderId: 'reviews',
      query: '',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'action', id: 'prompt:in-folder' });
  });
});
