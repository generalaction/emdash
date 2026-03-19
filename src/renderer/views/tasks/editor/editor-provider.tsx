import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';
import { getFileKind } from '@renderer/lib/fileKind';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../task-view-context';
import { useEditorViewContext } from './editor-view-provider';

interface EditorContextValue {
  projectId: string;
  taskId: string;
  modelRootPath: string;

  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  activeFile: ManagedFile | null;
  hasUnsavedChanges: boolean;
  isSaving: boolean;

  /** Path of the current unstable/preview tab (italic in the tab bar). Null when all tabs are stable. */
  previewFilePath: string | null;

  loadFile: (filePath: string) => Promise<void>;
  /** Opens a file as an unstable preview tab; replaces the existing preview tab if clean. */
  openFilePreview: (filePath: string) => Promise<void>;
  /** Promotes the preview tab to a stable tab. */
  pinFile: (filePath: string) => void;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  /** Marks a file dirty in React state; model content is source of truth in the registry. */
  markDirty: (filePath: string) => void;
  setActiveFile: (filePath: string | null) => void;

  fileChanges: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }[];

  handleCloseFile: (filePath: string) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

export function useEditorContext(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditorContext must be used within EditorProvider');
  return ctx;
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const { task } = useTaskViewContext();

  const projectId = task?.projectId ?? '';
  const taskId = task?.id ?? '';
  const modelRootPath = `task:${taskId}`;

  const restoringRef = useRef(false);

  const { clearPreviewMode } = useEditorViewContext();

  const [openFiles, setOpenFiles] = useState<Map<string, ManagedFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [previewFilePath, setPreviewFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeFile = activeFilePath ? (openFiles.get(activeFilePath) ?? null) : null;
  const hasUnsavedChanges = Array.from(openFiles.values()).some((f) => f.isDirty);

  // Persist open files / active path to localStorage.
  useEffect(() => {
    if (restoringRef.current) return;
    saveEditorState(taskId, {
      openFilePaths: Array.from(openFiles.keys()),
      activeFilePath,
      previewFilePath,
    });
  }, [taskId, openFiles, activeFilePath, previewFilePath]);

  /**
   * Internal: load a file's content and register models in the registry.
   *
   * Three-phase approach to eliminate the "no file open" flash and show a
   * loading state for slow (e.g. SSH) reads:
   *
   * 1. **Synchronous** — insert a `{ isLoading: true }` placeholder into
   *    `openFiles` immediately so the tab bar is never empty.
   * 2. **Async I/O** — read/fetch the file content via RPC.
   * 3. **Settle** — replace the placeholder with the final `ManagedFile`.
   */
  const loadFileInternal = useCallback(
    async (filePath: string) => {
      const kind = getFileKind(filePath);

      // Phase 1 — synchronous placeholder (no await, no flash).
      setOpenFiles((prev) =>
        new Map(prev).set(filePath, {
          path: filePath,
          kind,
          isLoading: kind !== 'binary', // binary needs no I/O
          content: '',
          originalContent: '',
          isDirty: false,
        })
      );

      // Phase 2+3 — async I/O, then replace placeholder.
      if (kind === 'binary') {
        // Nothing to load — placeholder already has isLoading: false.
        return;
      }

      if (kind === 'image') {
        const result = await rpc.fs.readImage(projectId, taskId, filePath);
        const dataUrl = result.success ? (result.data?.dataUrl ?? '') : '';
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'image',
            isLoading: false,
            content: dataUrl,
            originalContent: dataUrl,
            isDirty: false,
          })
        );
        return;
      }

      // 'text' and 'svg': pre-read to detect truncation before registering Monaco models.
      const readResult = await rpc.fs.readFile(projectId, taskId, filePath);

      if (!readResult.success) {
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'binary', // treat unreadable files as unsupported
            isLoading: false,
            content: '',
            originalContent: '',
            isDirty: false,
          })
        );
        return;
      }

      if (readResult.data?.truncated) {
        setOpenFiles((prev) =>
          new Map(prev).set(filePath, {
            path: filePath,
            kind: 'too-large',
            isLoading: false,
            content: '',
            originalContent: '',
            isDirty: false,
            totalSize: readResult.data?.totalSize,
          })
        );
        return;
      }

      const language = getMonacoLanguageId(filePath);

      // Register disk model first (buffer seeds from it), then buffer.
      // Awaiting both before setting state guarantees models exist for PooledCodeEditor.
      await modelRegistry.registerModel(
        projectId,
        taskId,
        modelRootPath,
        filePath,
        language,
        'disk'
      );
      await modelRegistry.registerModel(
        projectId,
        taskId,
        modelRootPath,
        filePath,
        language,
        'buffer'
      );

      const diskValue =
        modelRegistry.getDiskValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '';
      setOpenFiles((prev) =>
        new Map(prev).set(filePath, {
          path: filePath,
          kind, // 'text' or 'svg'
          isLoading: false,
          content: diskValue,
          originalContent: diskValue,
          isDirty: false,
        })
      );
    },
    [projectId, taskId, modelRootPath]
  );

  // Restore open files from localStorage on mount, then apply any persisted unsaved buffers.
  useEffect(() => {
    if (!taskId) return;
    restoringRef.current = true;

    const state = getEditorState(taskId);

    const restore = async () => {
      if (state?.openFilePaths?.length) {
        for (const filePath of state.openFilePaths) {
          await loadFileInternal(filePath).catch(() => {
            // Skip missing / deleted files silently.
          });
        }
        if (state.activeFilePath && state.openFilePaths.includes(state.activeFilePath)) {
          setActiveFilePath(state.activeFilePath);
        }
        if (state.previewFilePath && state.openFilePaths.includes(state.previewFilePath)) {
          setPreviewFilePath(state.previewFilePath);
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

      restoringRef.current = false;
    };

    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

  // Conflict dialog — shown lazily from saveFile when a pending conflict is detected.
  const showConflictModal = useShowModal('conflictDialog');

  const loadFile = useCallback(
    async (filePath: string) => {
      await loadFileInternal(filePath);
      // Promote to stable if it was the preview tab.
      setPreviewFilePath((prev) => (prev === filePath ? null : prev));
      setActiveFilePath(filePath);
    },
    [loadFileInternal]
  );

  const saveFile = useCallback(
    async (filePath?: string) => {
      const targetPath = filePath ?? activeFilePath;
      if (!targetPath) return;

      const file = openFiles.get(targetPath);
      if (!file?.isDirty) return;

      const uri = buildMonacoModelPath(modelRootPath, targetPath);

      // If the file was externally modified while the buffer had unsaved edits,
      // show the conflict dialog before writing. The save completes inside onSuccess
      // so the user's choice is applied atomically.
      if (modelRegistry.hasPendingConflict(uri)) {
        showConflictModal({
          filePath: targetPath,
          onSuccess: async (accept) => {
            if (accept) {
              // "Accept Incoming" — discard user edits, reload buffer from disk.
              modelRegistry.reloadFromDisk(uri); // also clears pendingConflict
              void rpc.editorBuffer.clearBuffer(projectId, taskId, targetPath);
              const content = modelRegistry.getDiskValue(uri) ?? '';
              setOpenFiles((prev) => {
                const next = new Map(prev);
                const existing = next.get(targetPath);
                if (existing) {
                  next.set(targetPath, {
                    ...existing,
                    isDirty: false,
                    content,
                    originalContent: content,
                  });
                }
                return next;
              });
            } else {
              // "Keep Mine" — write the user's buffer to disk.
              setIsSaving(true);
              try {
                const content = await modelRegistry.saveFileToDisk(uri); // also clears pendingConflict
                if (content !== null) {
                  setOpenFiles((prev) => {
                    const next = new Map(prev);
                    const updated = next.get(targetPath);
                    if (updated) {
                      next.set(targetPath, {
                        ...updated,
                        isDirty: false,
                        originalContent: content,
                        content,
                      });
                    }
                    return next;
                  });
                }
              } finally {
                setIsSaving(false);
              }
            }
          },
        });
        return;
      }

      setIsSaving(true);
      try {
        const content = await modelRegistry.saveFileToDisk(uri);
        if (content !== null) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            const updated = next.get(targetPath);
            if (updated) {
              next.set(targetPath, {
                ...updated,
                isDirty: false,
                originalContent: content,
                content,
              });
            }
            return next;
          });
        } else {
          console.error('Failed to save file:', targetPath);
        }
      } catch (error) {
        console.error('Error saving file:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [activeFilePath, openFiles, modelRootPath, projectId, taskId, showConflictModal]
  );

  const saveAllFiles = useCallback(async () => {
    const dirtyPaths = Array.from(openFiles.entries())
      .filter(([, f]) => f.isDirty)
      .map(([p]) => p);
    for (const path of dirtyPaths) {
      await saveFile(path);
    }
  }, [openFiles, saveFile]);

  const closeFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
      setActiveFilePath((prev) => {
        if (prev !== filePath) return prev;
        const keys = Array.from(openFiles.keys()).filter((k) => k !== filePath);
        return keys[keys.length - 1] ?? null;
      });
    },
    [openFiles]
  );

  const markDirty = useCallback((filePath: string) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      const existing = next.get(filePath);
      if (!existing || existing.isDirty) return prev;
      next.set(filePath, { ...existing, isDirty: true });
      return next;
    });
  }, []);

  const setActiveFile = useCallback((filePath: string | null) => {
    setActiveFilePath(filePath);
  }, []);

  const handleCloseFile = useCallback(
    (filePath: string) => {
      const uri = buildMonacoModelPath(modelRootPath, filePath);
      // Decrement ref counts; models are disposed when counts reach 0.
      modelRegistry.unregisterModel(uri);
      modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
      void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);

      closeFile(filePath);
      clearPreviewMode(filePath);
      setPreviewFilePath((prev) => (prev === filePath ? null : prev));
    },
    [closeFile, clearPreviewMode, projectId, taskId, modelRootPath]
  );

  /**
   * Opens a file as an unstable preview tab (single-click behaviour).
   * If there is already a clean preview tab, it is closed and replaced.
   * If the file is already open (stable or preview), it is simply activated.
   *
   * Load order is intentionally reversed vs the old approach:
   *   NEW: load new file first → close old preview
   * The synchronous loading placeholder added by `loadFileInternal` ensures
   * `openFiles` is never empty during the transition, eliminating the flash.
   */
  const openFilePreview = useCallback(
    async (filePath: string) => {
      if (openFiles.has(filePath)) {
        setActiveFilePath(filePath);
        return;
      }

      // Capture the outgoing preview path before any awaits.
      const outgoingPreview = previewFilePath;

      // Load the new file first. The synchronous placeholder phase of
      // loadFileInternal immediately adds the new entry to openFiles, so the
      // tab bar is never empty while waiting for async I/O to complete.
      await loadFileInternal(filePath);
      setPreviewFilePath(filePath);
      setActiveFilePath(filePath);

      // Now it is safe to remove the old preview — the new file is already present.
      if (outgoingPreview && outgoingPreview !== filePath) {
        setOpenFiles((prev) => {
          const previewFile = prev.get(outgoingPreview);
          if (!previewFile || previewFile.isDirty) return prev;

          // Clean up Monaco models for the outgoing preview tab.
          const uri = buildMonacoModelPath(modelRootPath, outgoingPreview);
          modelRegistry.unregisterModel(uri);
          modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
          void rpc.editorBuffer.clearBuffer(projectId, taskId, outgoingPreview);
          clearPreviewMode(outgoingPreview);

          const next = new Map(prev);
          next.delete(outgoingPreview);
          return next;
        });
        setPreviewFilePath(filePath);
      }
    },
    [
      openFiles,
      previewFilePath,
      loadFileInternal,
      modelRootPath,
      projectId,
      taskId,
      clearPreviewMode,
    ]
  );

  /** Promotes the preview tab to a stable tab (double-click on tab). */
  const pinFile = useCallback((filePath: string) => {
    setPreviewFilePath((prev) => (prev === filePath ? null : prev));
  }, []);

  // Cleanup: unregister all models for this task on unmount.
  const openFilesRef = useRef(openFiles);
  openFilesRef.current = openFiles;
  useEffect(() => {
    return () => {
      if (!projectId || !taskId) return;
      for (const filePath of openFilesRef.current.keys()) {
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
        openFiles,
        activeFilePath,
        activeFile,
        hasUnsavedChanges,
        isSaving,
        previewFilePath,
        loadFile,
        openFilePreview,
        pinFile,
        saveFile,
        saveAllFiles,
        closeFile,
        markDirty,
        setActiveFile,
        fileChanges: [],
        handleCloseFile,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}
