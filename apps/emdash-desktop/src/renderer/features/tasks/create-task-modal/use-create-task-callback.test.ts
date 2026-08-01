import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLoopPlanDraft } from '@renderer/features/loops/loop-plan-model';
import type { InitialConversationState } from '../conversations/initial-conversation-section';
import { useCreateTaskCallback } from './use-create-task-callback';
import type { CreateTaskState } from './use-create-task-state';

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  createTaskWithLoop: vi.fn(),
  open: vi.fn(),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getTaskManagerStore: () => ({
    createTask: mocks.createTask,
    createTaskWithLoop: mocks.createTaskWithLoop,
  }),
  getTaskView: () => ({ paneLayout: { open: mocks.open } }),
}));

vi.mock('@renderer/utils/logger', () => ({ log: { error: vi.fn() } }));

function initialConversation(): InitialConversationState {
  return {
    provider: 'codex',
    setProvider: () => {},
    prompt: 'This must be suppressed for a Loop',
    setPrompt: () => {},
    issueContext: null,
    setIssueContext: () => {},
    autoApprove: true,
    setAutoApprove: () => {},
    issueContextEditorOpen: false,
    setIssueContextEditorOpen: () => {},
    model: 'gpt-5.6-sol',
    setModel: () => {},
    useChatUi: true,
    setUseChatUi: () => {},
  };
}

function createState(loopEnabled: boolean): CreateTaskState {
  return {
    linkedType: null,
    linkedIssue: null,
    linkedPR: null,
    taskName: { effectiveTaskName: 'Feature task' },
    workspaceConfig: { resolvedConfig: { workspace: { kind: 'new-worktree' } } },
    loopPlan: {
      ...createDefaultLoopPlanDraft(),
      enabled: loopEnabled,
      goal: 'Ship the feature',
      validationCommands: ['pnpm test'],
      workPhases: [{ id: 'work-1', kind: 'work', name: 'Build', goal: 'Build it' }],
    },
    isValid: true,
  } as CreateTaskState;
}

describe('useCreateTaskCallback', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLElement;

  beforeEach(() => {
    dom = new JSDOM('<div id="root"></div>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('crypto', { randomUUID: () => 'task-1' });
    container = dom.window.document.getElementById('root')!;
    root = createRoot(container);
    mocks.createTask.mockResolvedValue(undefined);
    mocks.createTaskWithLoop.mockResolvedValue({ id: 'loop-1' });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    dom.window.close();
  });

  async function renderAndCreate(loopEnabled: boolean) {
    const navigate = vi.fn();
    const onClose = vi.fn();
    let create!: () => Promise<void>;

    function Harness() {
      create = useCreateTaskCallback({
        selectedProjectId: 'project-1',
        state: createState(loopEnabled),
        initialConversation: initialConversation(),
        navigate,
        onClose,
      }).handleCreateTask;
      return null;
    }

    await act(async () => root.render(React.createElement(Harness)));
    await act(async () => create());
    return { navigate, onClose };
  }

  it('uses atomic creation, suppresses the ordinary prompt, and pins the Loop tab', async () => {
    const { navigate, onClose } = await renderAndCreate(true);

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(mocks.createTaskWithLoop).toHaveBeenCalledWith(
      expect.objectContaining({
        task: expect.objectContaining({
          id: 'task-1',
          taskConfig: expect.objectContaining({ initialConversation: undefined }),
        }),
      })
    );
    expect(mocks.open).toHaveBeenCalledWith('loop', { loopId: 'loop-1' }, { preview: false });
    expect(navigate).toHaveBeenCalledWith('task', { projectId: 'project-1', taskId: 'task-1' });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('leaves ordinary task creation unchanged when Loop mode is off', async () => {
    await renderAndCreate(false);

    expect(mocks.createTaskWithLoop).not.toHaveBeenCalled();
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskConfig: expect.objectContaining({
          initialConversation: expect.objectContaining({ provider: 'codex' }),
        }),
      })
    );
    expect(mocks.open).not.toHaveBeenCalled();
  });
});
