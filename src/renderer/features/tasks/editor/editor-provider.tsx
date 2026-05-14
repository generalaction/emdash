import { autorun } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { registerActiveCodeEditor } from '@renderer/lib/editor/activeCodeEditor';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/lib/editor/utils';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { codeEditorPool } from '@renderer/lib/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/lib/monaco/monaco-config';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { useIsActiveTask } from '../hooks/use-is-active-task';

interface EditorContextValue {
  /**
   * Ref callback that appends the pane's stable Monaco editor container to the
   * given DOM element. Called by PaneContent to position the editor host.
   */
  setEditorHost: (el: HTMLElement | null) => void;
  /**
   * Explicitly re-runs layout() on the Monaco editor.
   * Call this whenever the Monaco host transitions from hidden to visible
   * (e.g. when activeRenderer switches to 'monaco').
   */
  triggerLayout: () => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider');
  return ctx;
}

export const EditorProvider = observer(function EditorProvider({
  children,
  taskId,
  projectId: _projectId,
}: {
  children: ReactNode;
  taskId: string;
  projectId: string;
}) {
  const taskView = useWorkspaceViewModel();
  const { editorView, tabGroupManager } = taskView;
  const { groupId, tabManager: paneTabManager } = useTabGroupContext();
  const { effectiveTheme } = useTheme();
  const isActive = useIsActiveTask(taskId);

  // Conflict dialog — shown when editorView.pendingConflictUri is set.
  const showConflictModal = useShowModal('conflictDialog');

  // The directly-created Monaco editor for this pane.
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  // The container <div> appended to the pane's host element.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const focusPendingRef = useRef(false);

  // Stable host element provided by PaneContent via setEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // Tracks the previously-attached buffer URI so modelRegistry.attach can
  // save view state before switching models.
  const prevBufUriRef = useRef<string | undefined>(undefined);

  // ---------------------------------------------------------------------------
  // Theme sync — update editor theme when app theme changes.
  // When this pane's editor is created it will inherit the current theme.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const m = codeEditorPool.getMonaco();
    if (m) defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme]);

  // ---------------------------------------------------------------------------
  // Editor creation — fires once on mount. Creates a Monaco editor directly
  // (no pool lease) using the globally-loaded Monaco instance. Monaco is
  // guaranteed to be loaded before any pane renders (bootstrap awaits pool init).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const m = (globalThis as any).__monaco as typeof monacoNS | undefined;
    if (!m) return;

    const container = document.createElement('div');
    container.style.width = '100%';
    container.style.height = '100%';
    containerRef.current = container;

    const editor = m.editor.create(container, { ...DEFAULT_EDITOR_OPTIONS, glyphMargin: true });
    editorRef.current = editor;

    configureMonacoEditor(editor);

    const cleanupActive = registerActiveCodeEditor(editor);

    addMonacoKeyboardShortcuts(editor, m as typeof monacoNS, {
      onSave: () => {
        const path = paneTabManager.activeFilePath;
        if (path) void editorView.saveFile(path);
      },
      onSaveAll: () => {
        void editorView.saveAllFiles();
      },
    });

    const focusDisposable = editor.onDidFocusEditorWidget(() => {
      taskView.setFocusedRegion('main');
      tabGroupManager.setActiveGroup(groupId);
    });

    // Satisfy any focus request that arrived before the editor was ready.
    if (focusPendingRef.current && editor.getModel()) {
      focusPendingRef.current = false;
      editor.focus();
    }

    if (hostRef.current) {
      hostRef.current.appendChild(container);
      editor.layout();
    }

    return () => {
      focusDisposable.dispose();
      cleanupActive();
      editor.dispose();
      container.remove();
      editorRef.current = null;
      containerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Model attachment — autorun that re-evaluates whenever the pane-local active
  // file or model registration status changes.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      autorun(() => {
        const editor = editorRef.current;
        if (!editor) return;

        const entry = paneTabManager.activeFileEntry; // reactive
        const newBufUri = entry ? buildMonacoModelPath(editorView.modelRootPath, entry.path) : null;

        if (!newBufUri) {
          editor.setModel(null);
          prevBufUriRef.current = undefined;
          return;
        }

        const status = modelRegistry.modelStatus.get(newBufUri); // reactive
        if (status !== 'ready') return;

        modelRegistry.attach(editor, newBufUri, prevBufUriRef.current);
        prevBufUriRef.current = newBufUri;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Restore — re-apply crash-recovery buffer content for persisted open tabs.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!taskId) return;
    void editorView.restoreBuffers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ---------------------------------------------------------------------------
  // Conflict dialog — reaction on pendingConflictUri shows the modal.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      autorun(() => {
        const uri = editorView.pendingConflictUri; // reactive
        if (!uri) return;
        const filePath = uri.replace(`file://${editorView.modelRootPath}/`, '');
        if (!editorView.openFilePaths.includes(filePath)) return;
        showConflictModal({
          filePath,
          onSuccess: (accept) => {
            void editorView.resolveConflict(accept);
          },
        });
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Focus restore — when this task becomes active and focusedRegion is 'main',
  // focus Monaco if a model is loaded; otherwise queue the intent.
  // ---------------------------------------------------------------------------
  const focusedRegion = taskView.focusedRegion;
  useEffect(() => {
    if (!isActive || focusedRegion !== 'main') return;
    // Only the focused pane should attempt to focus.
    if (tabGroupManager.activeGroupId !== groupId) return;
    const editor = editorRef.current;
    if (editor?.getModel()) {
      editor.focus();
    } else {
      focusPendingRef.current = true;
    }
  }, [isActive, focusedRegion, groupId, tabGroupManager.activeGroupId]);

  // ---------------------------------------------------------------------------
  // setEditorHost — called by PaneContent to give the editor a stable DOM node.
  // ---------------------------------------------------------------------------
  const setEditorHost = useCallback((el: HTMLElement | null) => {
    hostRef.current = el;
    const container = containerRef.current;
    const editor = editorRef.current;
    if (el && container && editor) {
      el.appendChild(container);
      editor.layout();
    }
  }, []);

  // ---------------------------------------------------------------------------
  // triggerLayout — called when the Monaco host transitions from hidden to visible.
  // ---------------------------------------------------------------------------
  const triggerLayout = useCallback(() => {
    editorRef.current?.layout();
  }, []);

  return (
    <EditorContext.Provider value={{ setEditorHost, triggerLayout }}>
      {children}
    </EditorContext.Provider>
  );
});
