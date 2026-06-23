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

  it('allows confirming before delete preflight finishes', () => {
    mocks.getDeletePreflight.mockReturnValue(new Promise(() => {}));
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

    act(() => {
      deleteButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onSuccess).toHaveBeenCalledWith({ deleteWorktree: true, deleteBranch: false });
  });
});
