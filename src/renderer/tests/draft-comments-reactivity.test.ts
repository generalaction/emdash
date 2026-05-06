import { autorun, isObservableMap } from 'mobx';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DraftCommentsStore } from '@renderer/features/tasks/diff-view/stores/draft-comments-store';

describe('DraftCommentsStore reactivity', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(
      '11111111-1111-1111-1111-111111111111'
    );
  });

  it('exposes observable map state', () => {
    const store = new DraftCommentsStore('task-1');
    expect(isObservableMap((store as unknown as { commentsById: unknown }).commentsById)).toBe(
      true
    );
  });

  it('reacts to add/delete from autorun consumers', () => {
    const store = new DraftCommentsStore('task-1');
    const seen: number[] = [];
    const dispose = autorun(() => {
      seen.push(store.count);
    });

    store.addComment({ filePath: 'a.ts', lineNumber: 1, content: 'note' });
    store.deleteComment('11111111-1111-1111-1111-111111111111');
    dispose();

    expect(seen).toEqual([0, 1, 0]);
  });
});
