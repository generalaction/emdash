import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddContextPopoverProps } from './add-context-popover';
import type { ContextAction } from './context-actions';
import { ContextBar } from './context-bar';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  activeSession: {
    sessionId: 'session-1',
    pty: { terminal: { focus: vi.fn() } },
  },
  browserAnnotations: {
    annotations: [
      {
        id: 'annotation-1',
        taskId: 'task-1',
        browserId: 'browser-1',
        kind: 'element',
        status: 'pending',
        comment: 'Fix this button',
        url: 'http://localhost:3000/settings',
        title: 'Settings',
        elementPath: 'main > button:nth-child(1)',
        element: 'button',
        cssClasses: 'primary',
        nearbyText: 'Save changes',
        x: 12,
        y: 24,
        boundingBox: { x: 10, y: 20, width: 100, height: 32 },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    consumePending: vi.fn(),
  },
  conversations: {
    sessions: new Map(),
    conversations: new Map(),
  },
  getRegisteredTaskData: vi.fn(),
  getTaskStore: vi.fn(),
  pastePromptInjection: vi.fn(),
  sendInput: vi.fn(),
  captureTelemetry: vi.fn(),
  updateInterfaceSettings: vi.fn(),
}));

vi.mock('@renderer/features/library/prompts/use-prompt-library', () => ({
  usePromptLibrary: () => ({ value: [], isSaving: false }),
}));

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ update: mocks.updateInterfaceSettings, isSaving: false }),
}));

vi.mock('@renderer/features/tabs/pane-context', () => ({
  usePaneContext: () => ({ paneId: 'pane-1' }),
}));

vi.mock('@renderer/features/tasks/stores/task-selectors', () => ({
  getRegisteredTaskData: mocks.getRegisteredTaskData,
  getTaskStore: mocks.getTaskStore,
}));

vi.mock('@renderer/features/tasks/task-view-context', () => ({
  useTaskViewContext: () => ({ projectId: 'project-1', taskId: 'task-1' }),
  useWorkspaceViewModel: () => ({ paneLayout: { activePaneId: 'pane-1' } }),
  useConversations: () => mocks.conversations,
}));

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    pty: {
      sendInput: mocks.sendInput,
    },
  },
}));

vi.mock('@renderer/lib/pty/prompt-injection', () => ({
  pastePromptInjection: mocks.pastePromptInjection,
}));

vi.mock('@renderer/utils/telemetryClient', () => ({
  captureTelemetry: mocks.captureTelemetry,
}));

let latestPopoverProps: AddContextPopoverProps | undefined;

vi.mock('./add-context-popover', () => ({
  AddContextPopover: (props: AddContextPopoverProps) => {
    latestPopoverProps = props;
    return null;
  },
}));

describe('ContextBar browser annotations', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    latestPopoverProps = undefined;
    mocks.activeSession.pty.terminal.focus.mockClear();
    mocks.browserAnnotations.consumePending.mockClear();
    mocks.getRegisteredTaskData.mockReturnValue({ linkedIssue: undefined });
    mocks.getTaskStore.mockReturnValue({
      draftComments: { comments: [] },
      browserAnnotations: mocks.browserAnnotations,
    });
    mocks.conversations.sessions = new Map([['conversation-1', mocks.activeSession]]);
    mocks.conversations.conversations = new Map([
      ['conversation-1', { data: { providerId: 'claude' } }],
    ]);
    mocks.pastePromptInjection.mockImplementation(async ({ sendInput }) => {
      await sendInput('pasted annotation context');
    });
    mocks.sendInput.mockResolvedValue(undefined);

    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  async function renderContextBar() {
    await act(async () => {
      root.render(
        React.createElement(ContextBar, { conversationId: 'conversation-1', hideTrigger: true })
      );
    });
  }

  function getBrowserAnnotationAction(): ContextAction {
    const action = latestPopoverProps?.actions.find((item) => item.kind === 'browser-annotations');
    if (!action) throw new Error('Expected browser annotations action');
    return action;
  }

  it('pastes browser annotations into the active terminal, submits, and consumes after success', async () => {
    await renderContextBar();

    const action = getBrowserAnnotationAction();
    await act(async () => {
      await latestPopoverProps?.onApplyAction('<browser_annotations />', action, { andSend: true });
    });

    expect(mocks.pastePromptInjection).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'claude',
        text: '<browser_annotations />',
        forceBracketedPaste: true,
      })
    );
    expect(mocks.sendInput).toHaveBeenNthCalledWith(1, 'session-1', 'pasted annotation context');
    expect(mocks.sendInput).toHaveBeenNthCalledWith(2, 'session-1', '\r');
    expect(mocks.captureTelemetry).toHaveBeenCalledWith('browser_annotations_assigned', {
      annotation_count: 1,
      page_count: 1,
      and_send: true,
      provider: 'claude',
    });
    expect(mocks.browserAnnotations.consumePending).toHaveBeenCalledOnce();
    expect(mocks.activeSession.pty.terminal.focus).toHaveBeenCalledOnce();
  });

  it('does not consume browser annotations when paste fails', async () => {
    mocks.pastePromptInjection.mockRejectedValueOnce(new Error('paste failed'));

    await renderContextBar();
    const action = getBrowserAnnotationAction();

    await expect(
      latestPopoverProps?.onApplyAction('<browser_annotations />', action)
    ).rejects.toThrow('paste failed');

    expect(mocks.browserAnnotations.consumePending).not.toHaveBeenCalled();
    expect(mocks.captureTelemetry).not.toHaveBeenCalledWith(
      'browser_annotations_assigned',
      expect.anything()
    );
    expect(mocks.activeSession.pty.terminal.focus).not.toHaveBeenCalled();
  });
});
