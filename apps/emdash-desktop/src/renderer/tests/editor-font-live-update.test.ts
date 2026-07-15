import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorSettings } from '@shared/core/app-settings';
import { EDITOR_FONT_SIZE_DEFAULT } from '@shared/core/editor/editor-settings';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => {
  const codeEditor = {
    updateOptions: vi.fn(),
    getOption: vi.fn(() => "Menlo, Monaco, 'Courier New', monospace"),
    onDidFocusEditorWidget: vi.fn(() => ({ dispose: vi.fn() })),
    getModel: vi.fn(() => null),
    setModel: vi.fn(),
    focus: vi.fn(),
    layout: vi.fn(),
    dispose: vi.fn(),
  };
  const modifiedEditor = {
    getOption: vi.fn((option: string) =>
      option === 'lineHeight' ? 20 : "Menlo, Monaco, 'Courier New', monospace"
    ),
    addCommand: vi.fn(),
    onDidContentSizeChange: vi.fn(() => ({ dispose: vi.fn() })),
    getContentHeight: vi.fn(() => 120),
  };
  const diffEditor = {
    updateOptions: vi.fn(),
    getModifiedEditor: vi.fn(() => modifiedEditor),
    getModel: vi.fn(() => null),
    setModel: vi.fn(),
    layout: vi.fn(),
    dispose: vi.fn(),
  };

  return {
    editorSettings: undefined as EditorSettings | undefined,
    codeEditor,
    modifiedEditor,
    diffEditor,
    createCodeEditor: vi.fn(() => codeEditor),
    createDiffEditor: vi.fn(() => diffEditor),
    setTheme: vi.fn(),
    cleanupActiveEditor: vi.fn(),
    restoreBuffers: vi.fn(async () => undefined),
  };
});

vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: (key: string) => ({
    value: key === 'editor' ? mocks.editorSettings : undefined,
  }),
}));

vi.mock('@renderer/features/tabs/pane-context', () => ({
  usePaneContext: () => ({ paneId: 'pane-1', pane: {} }),
}));

vi.mock('@renderer/features/tasks/task-view-context', () => {
  const taskView = {
    editorView: {
      modelRootPath: 'workspace:test',
      pendingConflictUri: null,
      openFilePaths: [],
      saveFile: vi.fn(),
      saveAllFiles: vi.fn(),
      restoreBuffers: mocks.restoreBuffers,
      resolveConflict: vi.fn(),
    },
    paneLayout: {
      activePaneId: 'pane-1',
      setActiveGroup: vi.fn(),
    },
    focusedRegion: null,
    setFocusedRegion: vi.fn(),
  };

  return {
    useTaskViewContext: () => ({ taskId: 'task-1' }),
    useWorkspaceViewModel: () => taskView,
  };
});

vi.mock('@renderer/features/tasks/hooks/use-is-active-task', () => ({
  useIsActiveTask: () => false,
}));

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emdark' }),
}));

vi.mock('@renderer/lib/modal/modal-provider', () => ({
  useShowModal: () => vi.fn(),
}));

vi.mock('@renderer/lib/editor/activeCodeEditor', () => ({
  registerActiveCodeEditor: () => mocks.cleanupActiveEditor,
}));

vi.mock('@renderer/lib/monaco/monaco-config', () => ({
  addMonacoKeyboardShortcuts: vi.fn(),
  configureMonacoEditor: vi.fn(),
}));

vi.mock('@renderer/lib/monaco/monaco-bootstrap', () => ({
  monacoBootstrap: {
    getMonaco: () => ({
      editor: {
        create: mocks.createCodeEditor,
        createDiffEditor: mocks.createDiffEditor,
        EditorOption: {
          fontFamily: 'fontFamily',
          lineHeight: 'lineHeight',
        },
      },
      KeyMod: { CtrlCmd: 1 },
      KeyCode: { KeyS: 2 },
    }),
    setTheme: mocks.setTheme,
  },
}));

vi.mock('@renderer/lib/monaco/monaco-model-registry', () => ({
  modelRegistry: {
    modelStatus: new Map<string, string>(),
    attach: vi.fn(),
    detach: vi.fn(),
    filePathForUri: vi.fn(() => undefined),
    getModelByUri: vi.fn(() => undefined),
    restoreDiffViewState: vi.fn(),
    saveDiffViewState: vi.fn(),
    saveFileToDisk: vi.fn(),
  },
}));

vi.mock('@renderer/lib/monaco/monacoModelPath', () => ({
  buildMonacoModelPath: vi.fn(() => 'file:///workspace/test.ts'),
}));

vi.mock('@renderer/features/tasks/editor/pane-selectors', () => ({
  activeFileEntry: () => null,
  activeFilePath: () => null,
}));

const { EditorProvider } = await import('@renderer/features/tasks/editor/editor-provider');
const { StickyDiffEditor } = await import('@renderer/lib/monaco/sticky-diff-editor');

describe('mounted editor font updates', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    mocks.editorSettings = undefined;
    vi.clearAllMocks();
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('KeyboardEvent', dom.window.KeyboardEvent);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('updates the mounted code editor when editor settings change', () => {
    act(() => {
      root.render(
        React.createElement(
          EditorProvider,
          null,
          React.createElement('span', null, 'initial settings')
        )
      );
    });

    expect(mocks.createCodeEditor).toHaveBeenCalledTimes(1);
    expect(mocks.codeEditor.updateOptions).toHaveBeenLastCalledWith({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
    });

    mocks.editorSettings = { fontFamily: 'JetBrains Mono', fontSize: 16 };
    act(() => {
      root.render(
        React.createElement(
          EditorProvider,
          null,
          React.createElement('span', null, 'updated settings')
        )
      );
    });

    expect(mocks.createCodeEditor).toHaveBeenCalledTimes(1);
    expect(mocks.codeEditor.updateOptions).toHaveBeenLastCalledWith({
      fontFamily: 'JetBrains Mono',
      fontSize: 16,
    });
  });

  it('updates the mounted diff editor when editor settings change', () => {
    const props = {
      originalUri: 'git:///workspace/test.ts',
      modifiedUri: 'file:///workspace/test.ts',
      diffStyle: 'split' as const,
    };

    act(() => {
      root.render(React.createElement(StickyDiffEditor, props));
    });

    expect(mocks.createDiffEditor).toHaveBeenCalledTimes(1);
    expect(mocks.diffEditor.updateOptions).toHaveBeenCalledWith({
      fontFamily: "Menlo, Monaco, 'Courier New', monospace",
      fontSize: EDITOR_FONT_SIZE_DEFAULT,
      lineHeight: 20,
    });

    mocks.editorSettings = { fontFamily: 'Fira Code', fontSize: 18 };
    act(() => {
      root.render(React.createElement(StickyDiffEditor, props));
    });

    expect(mocks.createDiffEditor).toHaveBeenCalledTimes(1);
    expect(mocks.diffEditor.updateOptions).toHaveBeenLastCalledWith({
      fontFamily: 'Fira Code',
      fontSize: 18,
      lineHeight: 0,
    });
  });
});
