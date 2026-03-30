import { autorun, reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { useDiffDecorations } from '@renderer/core/editor/use-diff-decorations';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { codeEditorPool } from '@renderer/core/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/core/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useMonacoLease } from '@renderer/core/monaco/use-monaco-lease';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import { useIsActiveTask } from '../hooks/use-is-active-task';
import { useRequireProvisionedTask } from '../task-view-context';

interface EditorContextValue {
  /**
   * Ref callback that appends the task's stable Monaco editor container to the
   * given DOM element. Called by EditorMainPanel to position the editor host.
   */
  setEditorHost: (el: HTMLElement | null) => void;
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
  const taskStore = useRequireProvisionedTask();
  const editorView = taskStore.editorView;
  const { effectiveTheme } = useTheme();
  const isActive = useIsActiveTask(taskId);

  // Conflict dialog — shown when editorView.pendingConflictUri is set.
  const showConflictModal = useShowModal('conflictDialog');

  // Lease is exposed as a MobX observable box — unified with activeFilePath and
  // modelStatus in a single autorun for reliable model attachment.
  const leaseBox = useMonacoLease(codeEditorPool);

  // editorRef — shared with useDiffDecorations and the focus-restore effect.
  // Updated reactively from leaseBox via a reaction below.
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);
  const focusPendingRef = useRef(false);

  // Stable host element provided by EditorMainPanel via setEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // Tracks the previously-attached buffer URI so modelRegistry.attach can
  // save view state before switching models.
  const prevBufUriRef = useRef<string | undefined>(undefined);

  // ---------------------------------------------------------------------------
  // Theme sync — update editor theme when app theme changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const m = codeEditorPool.getMonaco();
    if (m) defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme]);

  // ---------------------------------------------------------------------------
  // Editor setup — fires when the lease arrives. Configures the editor,
  // registers keyboard shortcuts, updates editorRef, satisfies any pending
  // focus request, and appends the container to the host.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => leaseBox.get(),
        (lease) => {
          editorRef.current = lease?.editor ?? null;

          if (!lease) return;

          lease.editor.updateOptions({ glyphMargin: true });
          configureMonacoEditor(lease.editor);

          const cleanupActive = registerActiveCodeEditor(lease.editor);
          lease.disposables.push({ dispose: cleanupActive });

          const monaco = codeEditorPool.getMonaco();
          if (monaco) {
            addMonacoKeyboardShortcuts(lease.editor, monaco as typeof monacoNS, {
              onSave: () => {
                void editorView.saveFile();
              },
              onSaveAll: () => {
                void editorView.saveAllFiles();
              },
            });
          }

          lease.disposables.push(
            lease.editor.onDidFocusEditorWidget(() => {
              taskStore.setFocusedRegion('main');
            })
          );

          // Satisfy any focus request that arrived before the lease resolved.
          if (focusPendingRef.current && lease.editor.getModel()) {
            focusPendingRef.current = false;
            lease.editor.focus();
          }

          if (hostRef.current) {
            hostRef.current.appendChild(lease.container);
            lease.editor.layout();
          }
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Model attachment — single autorun that re-evaluates whenever any of the
  // three inputs changes: lease, activeFilePath, or modelStatus.
  // Replaces the reaction+onceBufferReady pattern and the restore-effect
  // onceBufferReady. Covers: initial mount, remount, tab switching, and the
  // async model-registration race on first file open.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      autorun(() => {
        const lease = leaseBox.get(); // reactive
        const activePath = editorView.activeFilePath; // reactive

        if (!lease) return;

        const newBufUri = activePath
          ? buildMonacoModelPath(editorView.modelRootPath, activePath)
          : null;

        if (!newBufUri) {
          lease.editor.setModel(null);
          prevBufUriRef.current = undefined;
          return;
        }

        const status = modelRegistry.modelStatus.get(newBufUri); // reactive
        if (status !== 'ready') return;

        modelRegistry.attach(lease.editor, newBufUri, prevBufUriRef.current);
        prevBufUriRef.current = newBufUri;
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Restore — re-register Monaco models for persisted open tabs on mount.
  // The autorun above handles attachment once model statuses become 'ready'.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!taskId) return;
    void editorView.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ---------------------------------------------------------------------------
  // Conflict dialog — reaction on pendingConflictUri shows the modal.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => editorView.pendingConflictUri,
        (uri) => {
          if (!uri) return;
          const tab = editorView.tabs.find((t) => t.bufferUri === uri);
          if (!tab) return;
          showConflictModal({
            filePath: tab.path,
            onSuccess: async (accept) => {
              await editorView.resolveConflict(accept);
            },
          });
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Diff decorations — driven by active file path.
  // ---------------------------------------------------------------------------
  const bufferUri = editorView.activeFilePath
    ? buildMonacoModelPath(editorView.modelRootPath, editorView.activeFilePath)
    : '';
  useDiffDecorations(editorRef, bufferUri);

  // ---------------------------------------------------------------------------
  // Focus restore — when this task becomes active and focusedRegion is 'main',
  // focus Monaco if an editable model is loaded; otherwise queue the intent so
  // it is satisfied once the lease arrives (handled in the lease reaction above).
  // ---------------------------------------------------------------------------
  const focusedRegion = taskStore.focusedRegion;
  useEffect(() => {
    if (!isActive || focusedRegion !== 'main') return;
    const editor = editorRef.current;
    if (editor?.getModel()) {
      editor.focus();
    } else {
      focusPendingRef.current = true;
    }
  }, [isActive, focusedRegion]);

  // ---------------------------------------------------------------------------
  // setEditorHost — called by EditorMainPanel to give the editor a stable DOM node.
  // ---------------------------------------------------------------------------
  const setEditorHost = useCallback(
    (el: HTMLElement | null) => {
      hostRef.current = el;
      const lease = leaseBox.get();
      if (el && lease) {
        el.appendChild(lease.container);
        lease.editor.layout();
      }
    },
    [leaseBox]
  );

  return <EditorContext.Provider value={{ setEditorHost }}>{children}</EditorContext.Provider>;
});
