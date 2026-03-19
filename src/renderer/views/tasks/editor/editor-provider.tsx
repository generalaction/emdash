import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { gitStatusChangedChannel } from '@shared/events/appEvents';
import { events, rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';
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

function isImageFile(filePath: string): boolean {
  const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? imageExtensions.includes(ext) : false;
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
   * Models are registered (and awaited) BEFORE setOpenFiles is called so that
   * PooledCodeEditor always sees an existing buffer model when it receives the
   * updated activeFile prop.
   */
  const loadFileInternal = useCallback(
    async (filePath: string) => {
      if (isImageFile(filePath)) {
        const result = await rpc.fs.readImage(projectId, taskId, filePath);
        const dataUrl = result.success
          ? (result.data?.dataUrl ?? '[IMAGE_ERROR]')
          : '[IMAGE_ERROR]';
        const file: ManagedFile = {
          path: filePath,
          content: dataUrl,
          originalContent: dataUrl,
          isDirty: false,
        };
        setOpenFiles((prev) => new Map(prev).set(filePath, file));
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

      const file: ManagedFile = {
        path: filePath,
        content: modelRegistry.getDiskValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '',
        originalContent:
          modelRegistry.getDiskValue(buildMonacoModelPath(modelRootPath, filePath)) ?? '',
        isDirty: false,
      };
      setOpenFiles((prev) => new Map(prev).set(filePath, file));
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
            const model = modelRegistry.getModel(uri);
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

  // Register a conflict handler — invoked by the registry when an open file is
  // modified on disk while the buffer has unsaved edits.
  const showConflictModal = useShowModal('conflictDialog');
  useEffect(() => {
    if (!taskId) return;
    return modelRegistry.setConflictHandler(taskId, (filePath, uri) => {
      showConflictModal({
        filePath,
        onSuccess: (accept) => {
          if (accept) {
            modelRegistry.reloadFromDisk(uri);
            void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);
            const content = modelRegistry.getDiskValue(uri) ?? '';
            setOpenFiles((prev) => {
              const next = new Map(prev);
              const existing = next.get(filePath);
              if (existing) {
                next.set(filePath, {
                  ...existing,
                  isDirty: false,
                  content,
                  originalContent: content,
                });
              }
              return next;
            });
          }
          // false = "Keep Mine": buffer stays dirty, disk model holds newer content.
        },
      });
    });
  }, [taskId, projectId, showConflictModal]);

  // Refresh git base models whenever git HEAD changes (commits, rebases, etc.).
  useEffect(() => {
    if (!taskId) return;
    return events.on(gitStatusChangedChannel, () => {
      void modelRegistry.refreshGitBaseModels(projectId, taskId);
    });
  }, [taskId, projectId]);

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
      const content = modelRegistry.getValue(uri) ?? file.content;

      setIsSaving(true);
      try {
        const result = await rpc.fs.writeFile(projectId, taskId, targetPath, content);
        if (result.success) {
          modelRegistry.markSaved(uri);
          void rpc.editorBuffer.clearBuffer(projectId, taskId, targetPath);
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
          console.error('Failed to save file:', result.error);
        }
      } catch (error) {
        console.error('Error saving file:', error);
      } finally {
        setIsSaving(false);
      }
    },
    [activeFilePath, openFiles, projectId, taskId, modelRootPath]
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
      modelRegistry.unregisterModel(uri, 'buffer');
      modelRegistry.unregisterModel(uri, 'disk');
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
   */
  const openFilePreview = useCallback(
    async (filePath: string) => {
      if (openFiles.has(filePath)) {
        setActiveFilePath(filePath);
        return;
      }

      // Close the existing clean preview tab before opening the new one.
      setOpenFiles((prev) => {
        const currentPreview = previewFilePath;
        if (!currentPreview || currentPreview === filePath) return prev;
        const previewFile = prev.get(currentPreview);
        if (!previewFile || previewFile.isDirty) return prev;

        // Clean up Monaco models for the outgoing preview tab.
        const uri = buildMonacoModelPath(modelRootPath, currentPreview);
        modelRegistry.unregisterModel(uri, 'buffer');
        modelRegistry.unregisterModel(uri, 'disk');
        void rpc.editorBuffer.clearBuffer(projectId, taskId, currentPreview);
        clearPreviewMode(currentPreview);

        const next = new Map(prev);
        next.delete(currentPreview);
        return next;
      });
      setPreviewFilePath(null);

      await loadFileInternal(filePath);
      setPreviewFilePath(filePath);
      setActiveFilePath(filePath);
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
        modelRegistry.unregisterModel(uri, 'buffer');
        modelRegistry.unregisterModel(uri, 'disk');
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
