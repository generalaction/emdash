import { describe, it, expect, beforeEach } from 'vitest';
import { buildCommentScopeKey, DraftCommentsStore } from '../../renderer/lib/DraftCommentsStore';

describe('DraftCommentsStore', () => {
  let store: DraftCommentsStore;

  beforeEach(() => {
    store = new DraftCommentsStore();
  });

  it('starts empty for any taskId', () => {
    expect(store.getAll('task-1')).toEqual([]);
    expect(store.getCount('task-1')).toBe(0);
  });

  it('adds a comment and returns an id', () => {
    const id = store.add('task-1', {
      filePath: 'src/app.ts',
      lineNumber: 10,
      lineContent: 'const x = 1;',
      content: 'Fix this',
    });
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
    const all = store.getAll('task-1');
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('Fix this');
    expect(all[0].taskId).toBe('task-1');
    expect(all[0].id).toBe(id);
  });

  it('isolates comments by taskId', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Comment A',
    });
    store.add('task-2', {
      filePath: 'b.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Comment B',
    });
    expect(store.getAll('task-1')).toHaveLength(1);
    expect(store.getAll('task-2')).toHaveLength(1);
    expect(store.getAll('task-1')[0].content).toBe('Comment A');
  });

  it('isolates comments by scoped task path key', () => {
    const scopeA = buildCommentScopeKey('task-1', '/repo/worktrees/codex');
    const scopeB = buildCommentScopeKey('task-1', '/repo/worktrees/claude');

    store.add(scopeA, {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Codex comment',
    });
    store.add(scopeB, {
      filePath: 'b.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Claude comment',
    });

    expect(store.getAll(scopeA)).toHaveLength(1);
    expect(store.getAll(scopeB)).toHaveLength(1);
    expect(store.getAll(scopeA)[0].taskId).toBe('task-1');
    expect(store.getAll(scopeA)[0].content).toBe('Codex comment');
    expect(store.getAll(scopeB)[0].content).toBe('Claude comment');
  });

  it('updates a comment', () => {
    const id = store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Original',
    });
    store.update('task-1', id, 'Updated');
    expect(store.getAll('task-1')[0].content).toBe('Updated');
  });

  it('removes a comment', () => {
    const id = store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'To delete',
    });
    store.remove('task-1', id);
    expect(store.getAll('task-1')).toHaveLength(0);
  });

  it('getForFile filters by filePath', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    store.add('task-1', {
      filePath: 'b.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'B',
    });
    expect(store.getForFile('task-1', 'a.ts')).toHaveLength(1);
    expect(store.getForFile('task-1', 'a.ts')[0].content).toBe('A');
  });

  it('consumeAll returns comments and clears them', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Consume me',
    });
    const consumed = store.consumeAll('task-1');
    expect(consumed).toHaveLength(1);
    expect(consumed[0].content).toBe('Consume me');
    expect(store.getAll('task-1')).toHaveLength(0);
    expect(store.getCount('task-1')).toBe(0);
  });

  it('notifies subscribers on mutations', () => {
    let callCount = 0;
    store.subscribe('task-1', () => callCount++);
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    expect(callCount).toBe(1);
    const id = store.getAll('task-1')[0].id;
    store.update('task-1', id, 'B');
    expect(callCount).toBe(2);
    store.remove('task-1', id);
    expect(callCount).toBe(3);
  });

  it('does not notify subscribers for other taskIds', () => {
    let callCount = 0;
    store.subscribe('task-1', () => callCount++);
    store.add('task-2', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Other task',
    });
    expect(callCount).toBe(0);
  });

  it('unsubscribe stops notifications', () => {
    let callCount = 0;
    const unsub = store.subscribe('task-1', () => callCount++);
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    expect(callCount).toBe(1);
    unsub();
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 2,
      lineContent: '',
      content: 'B',
    });
    expect(callCount).toBe(1);
  });

  it('getSnapshot returns stable reference when unchanged', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    const snap1 = store.getSnapshot('task-1');
    const snap2 = store.getSnapshot('task-1');
    expect(snap1).toBe(snap2);
  });

  it('consumeAll on empty taskId returns empty array', () => {
    const consumed = store.consumeAll('nonexistent');
    expect(consumed).toEqual([]);
  });

  it('update on nonexistent taskId is a no-op', () => {
    store.update('nonexistent', 'fake-id', 'content');
    expect(store.getAll('nonexistent')).toEqual([]);
  });

  it('update on nonexistent commentId does not emit', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Original',
    });
    let callCount = 0;
    store.subscribe('task-1', () => callCount++);
    store.update('task-1', 'nonexistent-id', 'New content');
    expect(callCount).toBe(0);
    expect(store.getAll('task-1')[0].content).toBe('Original');
  });

  it('remove on nonexistent commentId is a no-op and does not emit', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Keep me',
    });
    let callCount = 0;
    store.subscribe('task-1', () => callCount++);
    store.remove('task-1', 'nonexistent-id');
    expect(store.getAll('task-1')).toHaveLength(1);
    expect(callCount).toBe(0);
  });

  it('a throwing listener does not prevent other listeners from being notified', () => {
    let secondCalled = false;
    store.subscribe('task-1', () => {
      throw new Error('boom');
    });
    store.subscribe('task-1', () => {
      secondCalled = true;
    });
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    expect(secondCalled).toBe(true);
  });

  it('remove cleans up Map entry when last comment is removed', () => {
    const id = store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Only one',
    });
    store.remove('task-1', id);
    // getSnapshot should return the EMPTY sentinel (same reference for all empty tasks)
    const snap1 = store.getSnapshot('task-1');
    const snap2 = store.getSnapshot('task-2');
    expect(snap1).toBe(snap2);
  });

  it('rejects adds beyond the per-scope limit', () => {
    for (let i = 0; i < 200; i++) {
      store.add('task-1', {
        filePath: 'a.ts',
        lineNumber: i,
        lineContent: '',
        content: `Comment ${i}`,
      });
    }
    expect(store.getCount('task-1')).toBe(200);

    // 201st should be silently rejected
    let callCount = 0;
    store.subscribe('task-1', () => callCount++);
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 999,
      lineContent: '',
      content: 'Over the limit',
    });
    expect(store.getCount('task-1')).toBe(200);
    expect(callCount).toBe(0); // no emit since nothing changed
  });

  it('consumeAll notifies subscribers', () => {
    let callCount = 0;
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'A',
    });
    store.subscribe('task-1', () => callCount++);
    store.consumeAll('task-1');
    expect(callCount).toBe(1);
  });
});
