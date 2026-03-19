import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AUTO_SAVE_DELAY } from '@renderer/constants/file-explorer';
import { rpc } from '@renderer/core/ipc';
import { useShowModal } from '@renderer/core/modal/modal-provider';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';
import { modelRegistry } from '@renderer/lib/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../task-view-context';
import { useEditorViewContext } from './editor-view-provider';

interface EditorContextValue {
  projectId: string;
  taskId: string;
  modelRootPath: string;

  // Open files state
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  activeFile: ManagedFile | null;
  hasUnsavedChanges: boolean;
  isSaving: boolean;

  // File operations
  loadFile: (filePath: string) => Promise<void>;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  /** Marks a file as dirty without updating content in state (content lives in the registry model). */
  markDirty: (filePath: string) => void;
  setActiveFile: (filePath: string | null) => void;

  // Git file changes (for tree coloring)
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

  const projectId = task?.id ? task.projectId : '';
  const taskId = task?.id ?? '';
  const modelRootPath = `task:${taskId}`;

  const restoringRef = useRef(false);
  const autoSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const { clearPreviewMode } = useEditorViewContext();

  const [openFiles, setOpenFiles] = useState<Map<string, ManagedFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeFile = activeFilePath ? (openFiles.get(activeFilePath) ?? null) : null;
  const hasUnsavedChanges = Array.from(openFiles.values()).some((f) => f.isDirty);

  // Persist open files / active path to localStorage
  useEffect(() => {
    if (restoringRef.current) return;
    saveEditorState(taskId, {
      openFilePaths: Array.from(openFiles.keys()),
      activeFilePath,
    });
  }, [taskId, openFiles, activeFilePath]);

  const loadFileInternal = useCallback(
    async (filePath: string) => {
      if (isImageFile(filePath)) {
        const result = await rpc.fs.readImage(projectId, taskId, filePath);
        if (result.success && result.data?.dataUrl) {
          const file: ManagedFile = {
            path: filePath,
            content: result.data.dataUrl,
            originalContent: result.data.dataUrl,
            isDirty: false,
          };
          setOpenFiles((prev) => new Map(prev).set(filePath, file));
        } else {
          const errorFile: ManagedFile = {
            path: filePath,
            content: '[IMAGE_ERROR]',
            originalContent: '[IMAGE_ERROR]',
            isDirty: false,
          };
          setOpenFiles((prev) => new Map(prev).set(filePath, errorFile));
        }
        return;
      }

      const result = await rpc.fs.readFile(projectId, taskId, filePath);
      if (!result.success) {
        console.error('Failed to load file:', result.error);
        return;
      }
      const diskContent = result.data.content;
      const language = getMonacoLanguageId(filePath);

      // Register the file in the model registry.
      // openFile is a no-op if the model already exists (preserves unsaved edits).
      modelRegistry.openFile(projectId, taskId, modelRootPath, filePath, diskContent, language);

      const file: ManagedFile = {
        path: filePath,
        content: diskContent,
        originalContent: diskContent,
        isDirty: false,
      };
      setOpenFiles((prev) => new Map(prev).set(filePath, file));
    },
    [projectId, taskId, modelRootPath]
  );

  // Restore open files from localStorage on mount, then restore unsaved buffers.
  useEffect(() => {
    if (!taskId) return;
    restoringRef.current = true;

    const state = getEditorState(taskId);

    const restore = async () => {
      if (state?.openFilePaths?.length) {
        for (const filePath of state.openFilePaths) {
          await loadFileInternal(filePath).catch(() => {
            /* skip missing files */
          });
        }
        if (state.activeFilePath && state.openFilePaths.includes(state.activeFilePath)) {
          setActiveFilePath(state.activeFilePath);
        }
      }

      // Restore any unsaved buffers from the main process into their models.
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

  // Register a conflict handler so the model registry can surface external-vs-dirty conflicts.
  const showConflictModal = useShowModal('conflictDialog');
  useEffect(() => {
    if (!taskId) return;
    return modelRegistry.setConflictHandler(taskId, (filePath, uri, newContent) => {
      showConflictModal({
        filePath,
        onSuccess: (accept) => {
          if (accept) {
            modelRegistry.reloadFromDisk(uri, newContent);
            void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);
            setOpenFiles((prev) => {
              const next = new Map(prev);
              const existing = next.get(filePath);
              if (existing) {
                next.set(filePath, {
                  ...existing,
                  isDirty: false,
                  content: newContent,
                  originalContent: newContent,
                });
              }
              return next;
            });
          }
          // false = Keep Mine: leave buffer and dirty state intact.
        },
      });
    });
  }, [taskId, projectId, showConflictModal]);

  const loadFile = useCallback(
    async (filePath: string) => {
      await loadFileInternal(filePath);
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

      // Cancel pending auto-save timer.
      const pending = autoSaveTimersRef.current.get(targetPath);
      if (pending) {
        clearTimeout(pending);
        autoSaveTimersRef.current.delete(targetPath);
      }

      // For text files, get content from the registry model (source of truth).
      // For image files, fall back to state content.
      const uri = buildMonacoModelPath(modelRootPath, targetPath);
      const content = modelRegistry.getValue(uri) ?? file.content;

      setIsSaving(true);
      try {
        const result = await rpc.fs.writeFile(projectId, taskId, targetPath, content);
        if (result.success) {
          modelRegistry.markSaved(uri);
          // Clear the persisted buffer since the file is now saved to disk.
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

  /**
   * Mark a file as dirty without updating content in React state.
   * Content is the source of truth in the Monaco model (MonacoModelRegistry).
   */
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
      // Cancel pending auto-save.
      const pending = autoSaveTimersRef.current.get(filePath);
      if (pending) {
        clearTimeout(pending);
        autoSaveTimersRef.current.delete(filePath);
      }

      // Close the model in the registry and clear any persisted buffer.
      const uri = buildMonacoModelPath(modelRootPath, filePath);
      modelRegistry.closeFile(uri);
      void rpc.editorBuffer.clearBuffer(projectId, taskId, filePath);

      closeFile(filePath);
      clearPreviewMode(filePath);
    },
    [closeFile, clearPreviewMode, projectId, taskId, modelRootPath]
  );

  // Cleanup: close all models for this task on unmount, cancel auto-save timers.
  useEffect(() => {
    const timers = autoSaveTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
      if (projectId && taskId) {
        modelRegistry.closeAllForTask(projectId, taskId);
      }
    };
    // Only run cleanup on unmount — projectId/taskId are stable for the life of this provider.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save debounce wiring: schedule a save whenever isDirty flips on.
  useEffect(() => {
    for (const [filePath, file] of openFiles) {
      if (!file.isDirty) continue;
      if (autoSaveTimersRef.current.has(filePath)) continue;
      const timer = setTimeout(() => {
        autoSaveTimersRef.current.delete(filePath);
        void saveFile(filePath);
      }, AUTO_SAVE_DELAY);
      autoSaveTimersRef.current.set(filePath, timer);
    }
  }, [openFiles, saveFile]);

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
        loadFile,
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
