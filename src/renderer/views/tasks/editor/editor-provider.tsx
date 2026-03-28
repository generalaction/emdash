import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { useDiffDecorations } from '@renderer/core/editor/use-diff-decorations';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { codeEditorPool, type CodePoolEntry } from '@renderer/core/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/core/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';

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
  projectId,
}: {
  children: ReactNode;
  taskId: string;
  projectId: string;
}) {
  const editorView = asProvisioned(getTaskStore(projectId, taskId))!.editorView;
  const { effectiveTheme } = useTheme();

  // Conflict dialog — shown when editorView.pendingConflictUri is set.
  const showConflictModal = useShowModal('conflictDialog');

  // Single Monaco editor per task — leased once on mount, released on unmount.
  const leaseRef = useRef<CodePoolEntry | null>(null);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);

  // Stable host element provided by EditorMainPanel via setEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // Cancel fn for any pending onceBufferReady callback. Cleared whenever the
  // active path changes so stale callbacks don't fire after a tab switch.
  const cancelReadyCallbackRef = useRef<(() => void) | null>(null);

  // ---------------------------------------------------------------------------
  // Editor lifecycle — lease once on mount, release on unmount.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    codeEditorPool.lease().then((lease) => {
      if (cancelled) {
        codeEditorPool.release(lease);
        return;
      }
      leaseRef.current = lease;
      editorRef.current = lease.editor;

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

      // Append to the host element if it was already set before the lease arrived.
      if (hostRef.current) {
        hostRef.current.appendChild(lease.container);
        lease.editor.layout();
      }
    });

    return () => {
      cancelled = true;
      editorRef.current = null;
      const lease = leaseRef.current;
      leaseRef.current = null;
      if (lease) codeEditorPool.release(lease);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Theme sync — update editor theme when app theme changes.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const m = codeEditorPool.getMonaco();
    if (m) defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
  }, [effectiveTheme]);

  // ---------------------------------------------------------------------------
  // Model switching — MobX reaction drives attach when activeFilePath changes.
  // ---------------------------------------------------------------------------
  useEffect(
    () =>
      reaction(
        () => editorView.activeFilePath,
        (path, prevPath) => {
          // Cancel any pending ready-callback for the previous path.
          cancelReadyCallbackRef.current?.();
          cancelReadyCallbackRef.current = null;

          const editor = editorRef.current;
          if (!editor) return;
          const bufUri = path ? buildMonacoModelPath(editorView.modelRootPath, path) : null;
          const prevBufUri = prevPath
            ? buildMonacoModelPath(editorView.modelRootPath, prevPath)
            : undefined;

          if (!bufUri) {
            editor.setModel(null);
            return;
          }

          // Immediate attach — succeeds when the buffer is already registered
          // (e.g. switching between already-open tabs).
          modelRegistry.attach(editor, bufUri, prevBufUri);

          // Deferred attach — fires when the buffer model becomes ready. This
          // handles the race where openFile() sets activeTabId synchronously
          // before _registerModels() has finished the async RPC + model creation.
          // onceBufferReady fires immediately if the model already exists, so
          // the second attach is a harmless no-op in the common case.
          const cancel = modelRegistry.onceBufferReady(bufUri, () => {
            if (editorRef.current && editorView.activeFilePath === path) {
              modelRegistry.attach(editorRef.current, bufUri);
            }
          });
          cancelReadyCallbackRef.current = cancel;
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

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
  // Restore — re-register Monaco models for persisted open tabs on mount, then
  // attach the editor to the active file's model once it is ready.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!taskId) return;
    void editorView.restore().then(() => {
      const activePath = editorView.activeFilePath;
      if (!activePath) return;
      const activeUri = buildMonacoModelPath(editorView.modelRootPath, activePath);
      // onceBufferReady fires immediately if the model is already registered,
      // or deferred until registration completes.
      modelRegistry.onceBufferReady(activeUri, () => {
        const editor = editorRef.current;
        if (editor) modelRegistry.attach(editor, activeUri);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // ---------------------------------------------------------------------------
  // setEditorHost — called by EditorMainPanel to give the editor a stable DOM node.
  // ---------------------------------------------------------------------------
  const setEditorHost = useCallback((el: HTMLElement | null) => {
    hostRef.current = el;
    if (el && leaseRef.current?.container) {
      el.appendChild(leaseRef.current.container);
      leaseRef.current.editor.layout();
    }
  }, []);

  return <EditorContext.Provider value={{ setEditorHost }}>{children}</EditorContext.Provider>;
});
