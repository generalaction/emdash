import { describe, it, expect, beforeEach } from 'vitest';
import { DraftCommentsStore } from '../../renderer/lib/DraftCommentsStore';
import { pendingInjectionManager } from '../../renderer/lib/PendingInjectionManager';
import { formatCommentsForAgent } from '../../renderer/lib/formatCommentsForAgent';

/**
 * Integration tests for the comment injection pipeline:
 * DraftCommentsStore → formatCommentsForAgent → PendingInjectionManager
 *
 * These test the logic that useCommentInjection orchestrates,
 * without requiring a React rendering environment.
 */
describe('comment injection integration', () => {
  let store: DraftCommentsStore;

  beforeEach(() => {
    store = new DraftCommentsStore();
    pendingInjectionManager.clear();
  });

  it('formats comments and sets pending injection', () => {
    store.add('task-1', {
      filePath: 'src/app.ts',
      lineNumber: 10,
      lineContent: 'const x = 1;',
      content: 'This should be a let',
    });

    const comments = store.getAll('task-1');
    const formatted = formatCommentsForAgent(comments, {
      includeIntro: false,
      leadingNewline: true,
    });

    expect(formatted).toContain('<user_comments>');
    expect(formatted).toContain('src/app.ts');
    expect(formatted).toContain('This should be a let');

    pendingInjectionManager.setPending(formatted);
    expect(pendingInjectionManager.hasPending()).toBe(true);
    expect(pendingInjectionManager.getPending()).toBe(formatted);
  });

  it('markUsed clears pending and fires callback', () => {
    store.add('task-1', {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Fix this',
    });

    const comments = store.getAll('task-1');
    const formatted = formatCommentsForAgent(comments, { leadingNewline: true });
    pendingInjectionManager.setPending(formatted);

    let callbackFired = false;
    const unsub = pendingInjectionManager.onInjectionUsed(() => {
      callbackFired = true;
    });

    pendingInjectionManager.markUsed();
    expect(pendingInjectionManager.hasPending()).toBe(false);
    expect(callbackFired).toBe(true);

    unsub();
  });

  it('consumeAll after markUsed callback clears the store', () => {
    const scopeKey = 'task-1';
    store.add(scopeKey, {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Comment A',
    });
    store.add(scopeKey, {
      filePath: 'b.ts',
      lineNumber: 5,
      lineContent: '',
      content: 'Comment B',
    });

    // Simulate what useCommentInjection does: set pending, then consume on used
    const formatted = formatCommentsForAgent(store.getAll(scopeKey), { leadingNewline: true });
    pendingInjectionManager.setPending(formatted);

    const unsub = pendingInjectionManager.onInjectionUsed(() => {
      store.consumeAll(scopeKey);
    });

    expect(store.getCount(scopeKey)).toBe(2);
    pendingInjectionManager.markUsed();
    expect(store.getCount(scopeKey)).toBe(0);

    unsub();
  });

  it('formats nothing when all comments are removed before injection', () => {
    const scopeKey = 'task-1';
    const id = store.add(scopeKey, {
      filePath: 'a.ts',
      lineNumber: 1,
      lineContent: '',
      content: 'Temp comment',
    });

    // User deletes the comment before it gets formatted
    store.remove(scopeKey, id);

    const formatted = formatCommentsForAgent(store.getAll(scopeKey), { leadingNewline: true });
    expect(formatted).toBe('');
    // With empty format output, hook would never call setPending
    expect(pendingInjectionManager.hasPending()).toBe(false);
  });
});
