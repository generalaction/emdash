import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import type * as monacoNS from 'monaco-editor';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef } from 'react';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { getFileKind } from '@renderer/core/editor/fileKind';
import { useDiffDecorations } from '@renderer/core/editor/use-diff-decorations';
import { events, rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { codeEditorPool, type CodePoolEntry } from '@renderer/core/monaco/monaco-code-pool';
import {
  addMonacoKeyboardShortcuts,
  configureMonacoEditor,
} from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { getMonacoTheme } from '@renderer/core/monaco/monaco-themes';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import {
  taskViewStateStore,
  type FileRendererData,
  type ManagedFileInput,
  type OpenedFile,
} from '@renderer/core/tasks/view/task-view-store';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';

/** Returns the default renderer for a given file kind. */
function getDefaultRenderer(kind: ReturnType<typeof getFileKind>): FileRendererData {
  switch (kind) {
    case 'markdown':
      return { kind: 'markdown' };
    case 'svg':
      return { kind: 'svg' };
    default:
      return { kind } as FileRendererData;
  }
}

interface EditorContextValue {
  projectId: string;
  taskId: string;
  modelRootPath: string;

  activeFilePath: string | null;
  isSaving: boolean;

  /** Path of the current unstable/preview tab (italic in the tab bar). Null when all tabs are stable. */
  previewFilePath: string | null;

  loadFile: (filePath: string) => void;
  /** Opens a file as an unstable preview tab; replaces the existing preview tab if clean. */
  openFilePreview: (filePath: string) => void;
  /** Promotes the preview tab to a stable tab. */
  pinFile: (filePath: string) => void;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  setActiveFile: (filePath: string | null) => void;

  /** Ordered list of open tabs with stable `tabId` for use as React keys. */
  tabs: Array<{ tabId: string; filePath: string }>;

  fileChanges: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }[];

  handleCloseFile: (filePath: string) => void;

  /**
   * Ref callback that appends the task's stable Monaco editor container to the given DOM element.
   * Called by EditorMainPanel to position the editor host.
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
  const modelRootPath = `task:${taskId}`;
  const editorView = taskViewStateStore.getOrCreate(taskId).editorView;
  const { effectiveTheme } = useTheme();

  // Conflict dialog — shown lazily from saveFile when a pending conflict is detected.
  const showConflictModal = useShowModal('conflictDialog');

  // Single Monaco editor per task — leased once on mount, released on unmount.
  const leaseRef = useRef<CodePoolEntry | null>(null);
  const editorRef = useRef<monacoNS.editor.IStandaloneCodeEditor | null>(null);

  // Stable host element provided by EditorMainPanel via setEditorHost.
  const hostRef = useRef<HTMLElement | null>(null);

  // Stable refs so the Monaco keyboard commands (registered once at lease time)
  // always call the latest version of each function without a stale closure.
  const saveFileRef = useRef<(filePath?: string) => Promise<void>>(() => Promise.resolve());
  const saveAllFilesRef = useRef<() => Promise<void>>(() => Promise.resolve());

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
            saveFileRef.current().catch(console.error);
          },
          onSaveAll: () => {
            saveAllFilesRef.current().catch(console.error);
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
          const editor = editorRef.current;
          if (!editor) return;
          const bufUri = path ? buildMonacoModelPath(modelRootPath, path) : null;
          const prevBufUri = prevPath ? buildMonacoModelPath(modelRootPath, prevPath) : undefined;
          if (bufUri) modelRegistry.attach(editor, bufUri, prevBufUri);
          else editor.setModel(null);
        }
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // ---------------------------------------------------------------------------
  // Diff decorations — driven by active file path.
  // ---------------------------------------------------------------------------
  const bufferUri = editorView.activeFilePath
    ? buildMonacoModelPath(modelRootPath, editorView.activeFilePath)
    : '';
  useDiffDecorations(editorRef, bufferUri);

  // ---------------------------------------------------------------------------
  // FS watcher — start for this task on mount, stop on unmount.
  // EditorProvider owns the watcher lifecycle instead of MonacoModelRegistry.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    rpc.fs.watchSetPaths(projectId, taskId, [''], 'editor').catch(() => {});
    const unsub = events.on(
      fsWatchEventChannel,
      (data) => void modelRegistry.handleFsEvents(data.taskId, data.events),
      taskId
    );
    return () => {
      rpc.fs.watchStop(projectId, taskId, 'editor').catch(() => {});
      unsub();
    };
  }, [projectId, taskId]);

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

  // ---------------------------------------------------------------------------
  // openTab — fire-and-forget file opening (no phases, no isLoading for Monaco).
  // ---------------------------------------------------------------------------
  const openTab = useCallback(
    (filePath: string) => {
      const kind = getFileKind(filePath);
      const existingRenderer = editorView.openFiles.get(filePath)?.renderer;
      const defaultRenderer = getDefaultRenderer(kind);
      // Preserve existing renderer if the kind matches (e.g. markdown-source stays open).
      const renderer =
        existingRenderer && existingRenderer.kind.startsWith(kind)
          ? existingRenderer
          : defaultRenderer;

      if (kind === 'image') {
        editorView.setFile({
          path: filePath,
          kind,
          renderer: { kind: 'image' },
          content: '',
          isLoading: true,
        });
        void rpc.fs.readImage(projectId, taskId, filePath).then((result) => {
          const dataUrl = result.success ? (result.data?.dataUrl ?? '') : '';
          editorView.setFile({
            path: filePath,
            kind,
            renderer: { kind: 'image' },
            content: dataUrl,
            isLoading: false,
          });
        });
        return;
      }

      editorView.setFile({
        path: filePath,
        kind,
        renderer,
        content: '',
        isLoading: false,
      });

      if (kind === 'text' || kind === 'markdown' || kind === 'svg') {
        const language = getMonacoLanguageId(filePath);
        // Fire-and-forget: registry deduplicates concurrent calls.
        void modelRegistry
          .registerModel(projectId, taskId, modelRootPath, filePath, language, 'disk')
          .then(() =>
            modelRegistry.registerModel(projectId, taskId, modelRootPath, filePath, language, 'git')
          )
          .then(() =>
            modelRegistry.registerModel(
              projectId,
              taskId,
              modelRootPath,
              filePath,
              language,
              'buffer'
            )
          )
          .then(() => {
            // Once buffer is ready, attach if this is the active file.
            const bufUri = buildMonacoModelPath(modelRootPath, filePath);
            const editor = editorRef.current;
            if (editor && editorView.activeFilePath === filePath) {
              const prevPath = editorView.activeFilePath;
              const prevBufUri =
                prevPath && prevPath !== filePath
                  ? buildMonacoModelPath(modelRootPath, prevPath)
                  : undefined;
              modelRegistry.attach(editor, bufUri, prevBufUri);
            }
          });
      }
    },
    [editorView, projectId, taskId, modelRootPath]
  );

  // Restore open files from view state on mount, then apply any persisted unsaved buffers.
  useEffect(() => {
    if (!taskId) return;

    // Snapshot of openedFiles at mount time — computed from openFiles observable.
    const openedFiles: OpenedFile[] = editorView.openedFiles;

    const restore = async () => {
      if (openedFiles.length) {
        for (const { tabId, path: filePath } of openedFiles) {
          // Pre-seed the tabId so setFile uses it (preserving stable keys).
          editorView.tabIds.set(filePath, tabId);
          openTab(filePath);
        }

        const openPaths = new Set(openedFiles.map((f) => f.path));

        const activeEntry = openedFiles.find((f) => f.tabId === editorView.activeTabId);
        if (activeEntry && openPaths.has(activeEntry.path)) {
          editorView.setActiveFilePath(activeEntry.path);
        }

        const previewEntry = openedFiles.find((f) => f.tabId === editorView.previewTabId);
        if (previewEntry && openPaths.has(previewEntry.path)) {
          editorView.setPreviewFilePath(previewEntry.path);
        }
      }

      // Restore persisted unsaved buffers into the buffer models.
      if (projectId && taskId) {
        try {
          const buffers = await rpc.editorBuffer.listBuffers(projectId, taskId);
          for (const { filePath, content } of buffers) {
            const uri = buildMonacoModelPath(modelRootPath, filePath);
            const model = modelRegistry.getModelByUri(uri);
            if (model) {
              model.setValue(content);
            }
          }
        } catch (e) {
          console.warn('[EditorProvider] Failed to restore buffers:', e);
        }
      }
    };

    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  const loadFile = useCallback(
    (filePath: string) => {
      openTab(filePath);
      // Promote to stable if it was the preview tab.
      if (editorView.previewFilePath === filePath) {
        editorView.setPreviewFilePath(null);
      }
      editorView.setActiveFilePath(filePath);
    },
    [editorView, openTab]
  );

  const saveFile = useCallback(
    async (filePath?: string) => {
      const targetPath = filePath ?? editorView.activeFilePath;
      if (!targetPath) return;

      const uri = buildMonacoModelPath(modelRootPath, targetPath);
      if (!modelRegistry.isDirty(uri)) return;

      if (modelRegistry.hasPendingConflict(uri)) {
        showConflictModal({
          filePath: targetPath,
          onSuccess: async (accept) => {
            if (accept) {
              // "Accept Incoming" — discard user edits, reload buffer from disk.
              modelRegistry.reloadFromDisk(uri);
              void rpc.editorBuffer.clearBuffer(projectId, taskId, targetPath);
            } else {
              // "Keep Mine" — write the user's buffer to disk.
              editorView.setIsSaving(true);
              try {
                await modelRegistry.saveFileToDisk(uri);
              } finally {
                editorView.setIsSaving(false);
              }
            }
          },
        });
        return;
      }

      editorView.setIsSaving(true);
      try {
        const result = await modelRegistry.saveFileToDisk(uri);
        if (result === null) {
          console.error('Failed to save file:', targetPath);
        }
      } catch (error) {
        console.error('Error saving file:', error);
      } finally {
        editorView.setIsSaving(false);
      }
    },
    [editorView, modelRootPath, projectId, taskId, showConflictModal]
  );

  // Keep stable refs current so keyboard shortcuts registered once always call latest versions.
  saveFileRef.current = saveFile;
  saveAllFilesRef.current = async () => {
    const dirtyPaths = Array.from(editorView.openFiles.keys()).filter((p) =>
      modelRegistry.isDirty(buildMonacoModelPath(modelRootPath, p))
    );
    for (const path of dirtyPaths) {
      await saveFile(path);
    }
  };

  const saveAllFiles = useCallback(async () => {
    return saveAllFilesRef.current();
  }, []);

  const closeFile = useCallback(
    (filePath: string) => {
      editorView.removeFile(filePath);
    },
    [editorView]
  );

  const setActiveFile = useCallback(
    (filePath: string | null) => {
      editorView.setActiveFilePath(filePath);
    },
    [editorView]
  );

  const handleCloseFile = useCallback(
    (filePath: string) => {
      const uri = buildMonacoModelPath(modelRootPath, filePath);
      // Decrement ref counts; models are evicted after 60s.
      modelRegistry.unregisterModel(uri);
      modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, 'HEAD'));
      void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);

      closeFile(filePath);
      if (editorView.previewFilePath === filePath) {
        editorView.setPreviewFilePath(null);
      }
    },
    [closeFile, editorView, projectId, taskId, modelRootPath]
  );

  /**
   * Opens a file as an unstable preview tab (single-click behaviour).
   * If there is already a clean preview tab, atomically swaps it with the
   * incoming file's placeholder — preventing a flash of two tabs.
   * If the file is already open (stable or preview), it is simply activated.
   */
  const openFilePreview = useCallback(
    (filePath: string) => {
      if (editorView.openFiles.has(filePath)) {
        editorView.setActiveFilePath(filePath);
        return;
      }

      const outgoingPreview = editorView.previewFilePath;
      const outgoingUri = outgoingPreview
        ? buildMonacoModelPath(modelRootPath, outgoingPreview)
        : null;
      const canSwap = outgoingPreview && outgoingUri && !modelRegistry.isDirty(outgoingUri);

      if (canSwap) {
        const kind = getFileKind(filePath);
        const defaultRenderer = getDefaultRenderer(kind);
        const incomingInput: ManagedFileInput = {
          path: filePath,
          kind,
          isLoading: kind === 'image',
          content: '',
          renderer: defaultRenderer,
        };

        // Atomic swap: remove outgoing and add incoming placeholder in one MobX action.
        // React sees a single render with the tab mutated in place — no flash.
        editorView.swapPreviewTab(outgoingPreview, incomingInput);

        // Clean up outgoing models (safe to do after the state update).
        modelRegistry.unregisterModel(outgoingUri);
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(outgoingUri));
        void rpc.editorBuffer.clearBuffer(projectId, taskId, outgoingPreview);
        // Remove the outgoing path's stolen tabId entry from the non-observable map.
        editorView.tabIds.delete(outgoingPreview);

        // Now actually open the new file.
        openTab(filePath);
      } else {
        openTab(filePath);
        editorView.setPreviewFilePath(filePath);
        editorView.setActiveFilePath(filePath);

        // Remove the old preview if it was clean.
        if (outgoingPreview && outgoingPreview !== filePath && outgoingUri) {
          if (!modelRegistry.isDirty(outgoingUri)) {
            modelRegistry.unregisterModel(outgoingUri);
            modelRegistry.unregisterModel(modelRegistry.toDiskUri(outgoingUri));
            void rpc.editorBuffer.clearBuffer(projectId, taskId, outgoingPreview);
            editorView.removeFile(outgoingPreview);
            editorView.setPreviewFilePath(filePath);
          }
        }
      }
    },
    [editorView, openTab, modelRootPath, projectId, taskId]
  );

  /** Promotes the preview tab to a stable tab (double-click on tab). */
  const pinFile = useCallback(
    (filePath: string) => {
      if (editorView.previewFilePath === filePath) {
        editorView.setPreviewFilePath(null);
      }
    },
    [editorView]
  );

  // Cleanup: unregister all models for this task on unmount.
  // Use a ref so the cleanup closure sees the latest openFiles without re-running.
  const editorViewRef = useRef(editorView);
  editorViewRef.current = editorView;
  useEffect(() => {
    return () => {
      if (!projectId || !taskId) return;
      for (const filePath of editorViewRef.current.openFiles.keys()) {
        const uri = buildMonacoModelPath(modelRootPath, filePath);
        modelRegistry.unregisterModel(uri);
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      }
    };
    // Only run on unmount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <EditorContext.Provider
      value={{
        projectId,
        taskId,
        modelRootPath,
        tabs: editorView.tabs,
        activeFilePath: editorView.activeFilePath,
        isSaving: editorView.isSaving,
        previewFilePath: editorView.previewFilePath,
        loadFile,
        openFilePreview,
        pinFile,
        saveFile,
        saveAllFiles,
        closeFile,
        setActiveFile,
        fileChanges: [],
        handleCloseFile,
        setEditorHost,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
});
