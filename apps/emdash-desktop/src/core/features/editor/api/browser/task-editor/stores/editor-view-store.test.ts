import { ok, type Result } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import type { TreeMutationError } from '@core/features/editor/browser/task-editor/stores/files-store';
import type { TaskEditorTreeState } from '@core/features/tasks/contributions/mementos';
import type { MementoHandle } from '@core/primitives/mementos/browser';
import type { PaneLayoutStore } from '@core/primitives/workbench-shell/browser/tabs/pane-layout-store';
import { EditorViewStore } from './editor-view-store';

function mementoHandle(initial: TaskEditorTreeState): MementoHandle<TaskEditorTreeState> {
  let value = initial;
  return {
    get value() {
      return value;
    },
    ready: Promise.resolve(),
    isPending: false,
    hasStoredValue: true,
    read: () => value,
    update: (next) => {
      value = typeof next === 'function' ? next(value) : next;
    },
    reset: async () => {},
    flush: async () => {},
    autoPersist: () => (() => {}) as ReturnType<MementoHandle<TaskEditorTreeState>['autoPersist']>,
    dispose: async () => {},
  };
}

describe('EditorViewStore file reveal', () => {
  it('runs Runtime reveal once and exposes a consumable presentation request', async () => {
    const treeHandle = mementoHandle({ version: '1', expandedPaths: [] });
    const store = new EditorViewStore(
      { groups: [] } as unknown as PaneLayoutStore,
      'project-1',
      'workspace-1',
      treeHandle
    );
    const revealFile = vi.fn().mockResolvedValue(ok(['/repo/src']));
    store.files = { revealFile } as unknown as NonNullable<EditorViewStore['files']>;

    await store.revealFile('/repo/src/app.ts');

    expect(revealFile).toHaveBeenCalledOnce();
    expect(revealFile).toHaveBeenCalledWith('/repo/src/app.ts', {
      signal: expect.any(AbortSignal),
    });
    expect(treeHandle.value.expandedPaths).toEqual(['/repo/src']);
    expect(store.revealFileRequest).toEqual({
      id: 1,
      path: '/repo/src/app.ts',
      status: 'ready',
    });

    store.consumeRevealFileRequest(2);
    expect(store.revealFileRequest?.id).toBe(1);
    store.consumeRevealFileRequest(1);
    expect(store.revealFileRequest).toBeNull();
    expect(revealFile).toHaveBeenCalledOnce();
  });

  it('ignores a reveal completion superseded by a newer request', async () => {
    const treeHandle = mementoHandle({ version: '1', expandedPaths: [] });
    const store = new EditorViewStore(
      { groups: [] } as unknown as PaneLayoutStore,
      'project-1',
      'workspace-1',
      treeHandle
    );
    const first = deferred<Result<string[], TreeMutationError>>();
    const second = deferred<Result<string[], TreeMutationError>>();
    const revealFile = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    store.files = { revealFile } as unknown as NonNullable<EditorViewStore['files']>;

    const firstRun = store.revealFile('/repo/old/file.ts');
    await vi.waitFor(() => expect(revealFile).toHaveBeenCalledOnce());
    const secondRun = store.revealFile('/repo/new/file.ts');
    second.resolve(ok(['/repo/new']));
    await secondRun;
    first.resolve(ok(['/repo/old']));
    await firstRun;

    expect(treeHandle.value.expandedPaths).toEqual(['/repo/new']);
    expect(store.revealFileRequest).toEqual({
      id: 2,
      path: '/repo/new/file.ts',
      status: 'ready',
    });
  });

  it('cancels the Runtime reveal superseded by a newer request', async () => {
    const treeHandle = mementoHandle({ version: '1', expandedPaths: [] });
    const store = new EditorViewStore(
      { groups: [] } as unknown as PaneLayoutStore,
      'project-1',
      'workspace-1',
      treeHandle
    );
    const first = deferred<Result<string[], TreeMutationError>>();
    let firstSignal: AbortSignal | undefined;
    const revealFile = vi.fn(
      (
        path: string,
        options?: { signal?: AbortSignal }
      ): Promise<Result<string[], TreeMutationError>> => {
        if (path === '/repo/old/file.ts') {
          firstSignal = options?.signal;
          return first.promise;
        }
        return Promise.resolve(ok(['/repo/new']));
      }
    );
    store.files = { revealFile } as unknown as NonNullable<EditorViewStore['files']>;

    const firstRun = store.revealFile('/repo/old/file.ts');
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    const secondRun = store.revealFile('/repo/new/file.ts');

    expect(firstSignal?.aborted).toBe(true);
    first.resolve(ok(['/repo/old']));
    await Promise.all([firstRun, secondRun]);
    expect(store.revealFileRequest).toMatchObject({
      path: '/repo/new/file.ts',
      status: 'ready',
    });
  });
});
