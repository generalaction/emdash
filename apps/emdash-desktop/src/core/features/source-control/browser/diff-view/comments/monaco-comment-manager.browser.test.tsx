import { observable, runInAction } from 'mobx';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import { act } from 'react';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { DraftCommentsStore } from '@core/features/source-control/api/browser/diff-view/stores/draft-comments-store';
import {
  getDraftCommentTargetKey,
  type DraftCommentTarget,
} from '@core/primitives/line-comments/api';
import { MonacoCommentManager } from './monaco-comment-manager';

self.MonacoEnvironment = { getWorker: () => new editorWorker() };
const target = { kind: 'working-tree', group: 'disk', path: 'a.ts' } as const;
const cleanups: Array<() => void | Promise<void>> = [];
beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function mountComments(
  store: DraftCommentsStore,
  renderSideBySide: boolean,
  getTarget: () => DraftCommentTarget = () => target
) {
  const host = document.createElement('div');
  host.style.cssText = 'width: 800px; height: 600px';
  document.body.append(host);
  cleanups.push(() => host.remove());
  const editor = monaco.editor.createDiffEditor(host, { renderSideBySide });
  let manager: MonacoCommentManager;
  await act(async () => {
    manager = new MonacoCommentManager(editor, {
      getComments: () => store.getCommentsForTarget(getDraftCommentTargetKey(getTarget())),
      onAddComment: (lineNumber, content, lineContent) => {
        store.addComment({ target: getTarget(), lineNumber, content, lineContent });
      },
      onEditComment: (id, content) => {
        store.updateComment(id, content);
      },
      onDeleteComment: (id) => {
        store.deleteComment(id);
      },
    });
  });
  let unmounted = false;
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await act(async () => manager.dispose());
    editor.dispose();
  };
  cleanups.push(unmount);
  const attachModels = async () => {
    const original = monaco.editor.createModel('before\n');
    const modified = monaco.editor.createModel('after\n');
    // Release the editor before its models during test teardown.
    cleanups.unshift(() => {
      original.dispose();
      modified.dispose();
    });
    await act(async () => editor.setModel({ original, modified }));
    await expect.poll(() => editor.getLineChanges()).not.toBeNull();
  };
  const renderedComments = () =>
    Array.from(host.querySelectorAll<HTMLTextAreaElement>('.comment-view-zone textarea')).map(
      (node) => node.value
    );
  return { editor, unmount, attachModels, renderedComments };
}

it.each([false, true])(
  'restores comments after reopening with delayed models (split: %s)',
  async (split) => {
    const store = new DraftCommentsStore('task');
    const addComment = async (content: string) => {
      await act(async () => {
        store.addComment({
          target,
          lineNumber: 2,
          content,
        });
      });
    };
    const first = await mountComments(store, split);
    await first.attachModels();
    await addComment('First comment');
    expect(first.renderedComments()).toEqual(['First comment']);

    await first.unmount();
    const reopened = await mountComments(store, split);
    await reopened.attachModels();
    expect(store.count).toBe(1);
    expect.soft(reopened.renderedComments()).toEqual(['First comment']);

    await addComment('Second comment');
    expect(reopened.renderedComments()).toEqual(['First comment', 'Second comment']);
  }
);

it.each([false, true])('restores comments after model replacement (split: %s)', async (split) => {
  const store = new DraftCommentsStore('task');
  const mounted = await mountComments(store, split);
  await mounted.attachModels();
  await act(async () => {
    store.addComment({
      target,
      lineNumber: 2,
      content: 'Keep this comment',
    });
  });
  expect(mounted.renderedComments()).toEqual(['Keep this comment']);
  await mounted.attachModels();
  expect(store.count).toBe(1);
  expect(mounted.renderedComments()).toEqual(['Keep this comment']);
});

it('tracks edits, deletions and target changes without a React render', async () => {
  const store = new DraftCommentsStore('task');
  const selected = observable.box<DraftCommentTarget>(target);
  const staged = { ...target, group: 'staged' } as const;
  const firstId = store.addComment({ target, lineNumber: 2, content: 'Working tree' });
  const stagedId = store.addComment({ target: staged, lineNumber: 2, content: 'Staged' });
  const mounted = await mountComments(store, false, () => selected.get());
  await mounted.attachModels();
  expect(mounted.renderedComments()).toEqual(['Working tree']);

  await act(async () => {
    store.updateComment(firstId, 'Updated');
  });
  expect(mounted.renderedComments()).toEqual(['Updated']);
  await act(async () => {
    runInAction(() => selected.set(staged));
  });
  expect(mounted.renderedComments()).toEqual(['Staged']);
  await act(async () => {
    store.deleteComment(stagedId);
  });
  expect(mounted.renderedComments()).toEqual([]);

  await act(async () => {
    mounted.editor.setModel(null);
  });
  await act(async () => {
    runInAction(() => selected.set(target));
  });
  await mounted.attachModels();
  expect(mounted.renderedComments()).toEqual(['Updated']);
});

it('stops observing drafts when the editor binding is disposed', async () => {
  const store = new DraftCommentsStore('task');
  const getTarget = vi.fn(() => target);
  const mounted = await mountComments(store, false, getTarget);
  await mounted.attachModels();
  expect(getTarget).toHaveBeenCalled();
  await mounted.unmount();
  getTarget.mockClear();
  store.addComment({ target, lineNumber: 2, content: 'After disposal' });
  expect(getTarget).not.toHaveBeenCalled();
  expect(mounted.renderedComments()).toEqual([]);
});
