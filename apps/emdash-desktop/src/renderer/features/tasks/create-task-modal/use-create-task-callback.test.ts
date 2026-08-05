import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitialConversationState } from '@renderer/features/tasks/task-config/initial-conversation-section';
import type { NavigateFnTyped } from '@renderer/lib/layout/navigation-provider';
import { useCreateTaskCallback } from './use-create-task-callback';
import type { CreateTaskState } from './use-create-task-state';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  logError: vi.fn(),
  tasks: new Map<string, { phase: string }>(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: () => ({ createTask: mocks.createTask, tasks: mocks.tasks }),
}));

vi.mock('@renderer/utils/logger', () => ({
  log: { error: mocks.logError },
}));

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('useCreateTaskCallback', () => {
  let dom: JSDOM;
  let root: Root;
  let handleCreateTask: (() => void) | undefined;
  const clearPrompt = vi.fn();

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    root = createRoot(dom.window.document.getElementById('root') as HTMLDivElement);
    handleCreateTask = undefined;
    clearPrompt.mockReset();
    mocks.createTask.mockReset();
    mocks.logError.mockReset();
    mocks.tasks.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  async function renderCallback() {
    const state = {
      isValid: true,
      taskName: { effectiveTaskName: 'Test task' },
      linkedType: null,
      linkedIssue: null,
      linkedPR: null,
      workspaceConfig: { resolvedConfig: {} },
    } as unknown as CreateTaskState;
    const initialConversation = {
      provider: null,
      clearPrompt,
    } as unknown as InitialConversationState;

    function Probe() {
      ({ handleCreateTask } = useCreateTaskCallback({
        selectedProjectId: 'project-1',
        state,
        initialConversation,
        navigate: (() => {}) as NavigateFnTyped,
        onClose: vi.fn(),
      }));
      return null;
    }

    await act(async () => root.render(React.createElement(Probe)));
  }

  it('clears the prompt only after task creation succeeds', async () => {
    const creation = deferred();
    mocks.createTask.mockReturnValue(creation.promise);
    await renderCallback();

    handleCreateTask?.();
    expect(clearPrompt).not.toHaveBeenCalled();

    await act(async () => creation.resolve());

    expect(clearPrompt).toHaveBeenCalledOnce();
  });

  it('preserves the prompt when task creation fails', async () => {
    const creation = deferred();
    mocks.createTask.mockReturnValue(creation.promise);
    await renderCallback();

    handleCreateTask?.();
    await act(async () => creation.reject(new Error('creation failed')));

    expect(clearPrompt).not.toHaveBeenCalled();
    expect(mocks.logError).toHaveBeenCalledOnce();
  });

  it('preserves the prompt when workspace provisioning fails', async () => {
    mocks.createTask.mockImplementation(async ({ id }: { id: string }) => {
      mocks.tasks.set(id, { phase: 'provision-error' });
    });
    await renderCallback();

    handleCreateTask?.();
    await act(async () => {});

    expect(clearPrompt).not.toHaveBeenCalled();
  });
});
