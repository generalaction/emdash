import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteTaskModal } from './delete-task-modal';

const mocks = vi.hoisted(() => ({
  getDeletePreflight: vi.fn(),
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    tasks: {
      getDeletePreflight: mocks.getDeletePreflight,
    },
  },
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

vi.mock('@renderer/lib/ui/dialog', async () => {
  const React = await import('react');
  return {
    DialogContentArea: ({ children, ...props }: React.ComponentProps<'div'>) =>
      React.createElement('div', props, children),
    DialogFooter: ({ children, ...props }: React.ComponentProps<'div'>) =>
      React.createElement('div', props, children),
    DialogHeader: ({ children, ...props }: React.ComponentProps<'div'>) =>
      React.createElement('div', props, children),
    DialogTitle: ({ children, ...props }: React.ComponentProps<'h2'>) =>
      React.createElement('h2', props, children),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('DeleteTaskModal', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    mocks.getDeletePreflight.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('keeps delete enabled and completes once pending preflight is clean', async () => {
    const pendingPreflight = deferred<{ tasks: [] }>();
    mocks.getDeletePreflight.mockReturnValue(pendingPreflight.promise);
    const onSuccess = vi.fn();

    act(() => {
      root.render(
        React.createElement(DeleteTaskModal, {
          projectId: 'project-1',
          tasks: [{ taskId: 'task-1', taskName: 'Slow task' }],
          onSuccess,
          onClose: vi.fn(),
        })
      );
    });

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete')
    );

    expect(deleteButton).toBeDefined();
    expect(deleteButton?.hasAttribute('disabled')).toBe(false);
    expect(container.textContent).toContain('Delete worktree');
    expect(container.textContent).not.toContain('Checking');

    act(() => {
      deleteButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onSuccess).not.toHaveBeenCalled();

    await act(async () => {
      pendingPreflight.resolve({ tasks: [] });
      await pendingPreflight.promise;
      await flushPromises();
    });

    expect(onSuccess).toHaveBeenCalledWith({ deleteWorktree: true, deleteBranch: false });
  });

  it('shows known dirty changes before delete preflight finishes', () => {
    mocks.getDeletePreflight.mockReturnValue(new Promise(() => {}));
    const onSuccess = vi.fn();

    act(() => {
      root.render(
        React.createElement(DeleteTaskModal, {
          projectId: 'project-1',
          tasks: [{ taskId: 'task-1', taskName: 'Dirty task', hasKnownUncommittedChanges: true }],
          onSuccess,
          onClose: vi.fn(),
        })
      );
    });

    expect(container.textContent).toContain(
      '"Dirty task" has uncommitted changes that will be lost.'
    );
    expect(container.textContent).toContain('Delete anyway');

    const deleteAnywayButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete anyway')
    );

    act(() => {
      deleteAnywayButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onSuccess).toHaveBeenCalledWith({ deleteWorktree: true, deleteBranch: false });
  });

  it('requires a second confirm when pending preflight discovers dirty changes', async () => {
    const pendingPreflight = deferred<{
      tasks: [
        {
          taskId: string;
          hasWorktree: boolean;
          hasUncommittedChanges: boolean;
          hasDeletableBranch: boolean;
        },
      ];
    }>();
    mocks.getDeletePreflight.mockReturnValue(pendingPreflight.promise);
    const onSuccess = vi.fn();

    act(() => {
      root.render(
        React.createElement(DeleteTaskModal, {
          projectId: 'project-1',
          tasks: [{ taskId: 'task-1', taskName: 'Late dirty task' }],
          onSuccess,
          onClose: vi.fn(),
        })
      );
    });

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete')
    );

    act(() => {
      deleteButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    await act(async () => {
      pendingPreflight.resolve({
        tasks: [
          {
            taskId: 'task-1',
            hasWorktree: true,
            hasUncommittedChanges: true,
            hasDeletableBranch: false,
          },
        ],
      });
      await pendingPreflight.promise;
      await flushPromises();
    });

    expect(onSuccess).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      '"Late dirty task" has uncommitted changes that will be lost.'
    );
    expect(container.textContent).toContain('Delete anyway');

    const deleteAnywayButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Delete anyway')
    );

    act(() => {
      deleteAnywayButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onSuccess).toHaveBeenCalledWith({ deleteWorktree: true, deleteBranch: false });
  });
});
