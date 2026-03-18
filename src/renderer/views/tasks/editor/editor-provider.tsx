import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AUTO_SAVE_DELAY, isMarkdownFile } from '@renderer/constants/file-explorer';
import { rpc } from '@renderer/core/ipc';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { getEditorState, saveEditorState } from '@renderer/lib/editorStateStorage';
import { useTaskViewContext } from '../task-view-context';

interface EditorContextValue {
  projectId: string;
  taskId: string;

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
  updateFileContent: (filePath: string, content: string) => void;
  setActiveFile: (filePath: string | null) => void;

  // Git file changes (for tree coloring)
  fileChanges: { path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' }[];

  // Preview mode (markdown defaults to preview)
  previewMode: Map<string, boolean>;
  togglePreview: (filePath: string) => void;
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

  const restoringRef = useRef(false);
  const autoSaveTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const [openFiles, setOpenFiles] = useState<Map<string, ManagedFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [previewMode, setPreviewMode] = useState<Map<string, boolean>>(new Map());

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

  // Restore open files from localStorage on mount
  useEffect(() => {
    if (!taskId) return;
    restoringRef.current = true;

    const state = getEditorState(taskId);
    if (!state || state.openFilePaths.length === 0) {
      restoringRef.current = false;
      return;
    }

    const restore = async () => {
      for (const filePath of state.openFilePaths) {
        await loadFileInternal(filePath).catch(() => {
          /* skip missing files */
        });
      }
      if (state.activeFilePath && state.openFilePaths.includes(state.activeFilePath)) {
        setActiveFilePath(state.activeFilePath);
      }
      restoringRef.current = false;
    };

    void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);

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
      const content = result.data.content;
      const file: ManagedFile = {
        path: filePath,
        content,
        originalContent: content,
        isDirty: false,
      };
      setOpenFiles((prev) => new Map(prev).set(filePath, file));
    },
    [projectId, taskId]
  );

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

      // Cancel pending auto-save timer
      const pending = autoSaveTimersRef.current.get(targetPath);
      if (pending) {
        clearTimeout(pending);
        autoSaveTimersRef.current.delete(targetPath);
      }

      setIsSaving(true);
      try {
        const result = await rpc.fs.writeFile(projectId, taskId, targetPath, file.content);
        if (result.success) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            const updated = next.get(targetPath);
            if (updated) {
              next.set(targetPath, {
                ...updated,
                isDirty: false,
                originalContent: updated.content,
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
    [activeFilePath, openFiles, projectId, taskId]
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

  const updateFileContent = useCallback(
    (filePath: string, content: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        const existing = next.get(filePath);
        if (!existing) return prev;
        next.set(filePath, { ...existing, content, isDirty: true });
        return next;
      });

      // Schedule auto-save
      const existing = autoSaveTimersRef.current.get(filePath);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        autoSaveTimersRef.current.delete(filePath);
        void saveFile(filePath);
      }, AUTO_SAVE_DELAY);
      autoSaveTimersRef.current.set(filePath, timer);
    },
    [saveFile]
  );

  const setActiveFile = useCallback((filePath: string | null) => {
    setActiveFilePath(filePath);
  }, []);

  const togglePreview = useCallback((filePath: string) => {
    setPreviewMode((prev) => {
      const next = new Map(prev);
      const current = next.get(filePath) ?? isMarkdownFile(filePath);
      next.set(filePath, !current);
      return next;
    });
  }, []);

  const handleCloseFile = useCallback(
    (filePath: string) => {
      // Cancel pending auto-save
      const pending = autoSaveTimersRef.current.get(filePath);
      if (pending) {
        clearTimeout(pending);
        autoSaveTimersRef.current.delete(filePath);
      }
      closeFile(filePath);
      setPreviewMode((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });
    },
    [closeFile]
  );

  // Cleanup auto-save timers on unmount
  useEffect(() => {
    const timers = autoSaveTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return (
    <EditorContext.Provider
      value={{
        projectId,
        taskId,
        openFiles,
        activeFilePath,
        activeFile,
        hasUnsavedChanges,
        isSaving,
        loadFile,
        saveFile,
        saveAllFiles,
        closeFile,
        updateFileContent,
        setActiveFile,
        fileChanges: [],
        previewMode,
        togglePreview,
        handleCloseFile,
      }}
    >
      {children}
    </EditorContext.Provider>
  );
}
