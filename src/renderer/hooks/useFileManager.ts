import { useState, useCallback, useEffect } from 'react';
import { AUTO_SAVE_DELAY } from '@/constants/file-explorer';
import { dispatchFileChangeEvent } from '@/lib/fileChangeEvents';

export interface ManagedFile {
  path: string;
  content: string;
  isDirty: boolean;
  originalContent: string;
}

interface UseFileManagerOptions {
  taskPath: string;
  autoSave?: boolean;
  autoSaveDelay?: number;
  onFileChange?: () => void; // Callback when files are modified/saved
}

interface UseFileManagerReturn {
  openFiles: Map<string, ManagedFile>;
  activeFilePath: string | null;
  activeFile: ManagedFile | null;
  hasUnsavedChanges: boolean;
  isSaving: boolean;
  loadFile: (filePath: string) => Promise<void>;
  saveFile: (filePath?: string) => Promise<void>;
  saveAllFiles: () => Promise<void>;
  closeFile: (filePath: string) => void;
  updateFileContent: (filePath: string, content: string) => void;
  setActiveFile: (filePath: string | null) => void;
}

/**
 * Custom hook for managing file operations in the code editor
 * Handles loading, saving, and tracking file changes
 */
export function useFileManager(options: UseFileManagerOptions): UseFileManagerReturn {
  const { taskPath, autoSave = true, autoSaveDelay = AUTO_SAVE_DELAY, onFileChange } = options;

  const [openFiles, setOpenFiles] = useState<Map<string, ManagedFile>>(new Map());
  const [activeFilePath, setActiveFilePath] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const activeFile = activeFilePath ? openFiles.get(activeFilePath) || null : null;
  const hasUnsavedChanges = Array.from(openFiles.values()).some((f) => f.isDirty);

  /**
   * Check if file is an image
   */
  const isImageFile = useCallback((filePath: string): boolean => {
    const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];
    const ext = filePath.split('.').pop()?.toLowerCase();
    return ext ? imageExtensions.includes(ext) : false;
  }, []);

  /**
   * Load a file from disk
   */
  const loadFile = useCallback(
    async (filePath: string) => {
      try {
        // For image files, load as base64
        if (isImageFile(filePath)) {
          const result = await window.electronAPI.fsReadImage(taskPath, filePath);

          if (result.success && result.dataUrl) {
            const file: ManagedFile = {
              path: filePath,
              content: result.dataUrl,
              originalContent: result.dataUrl,
              isDirty: false,
            };

            setOpenFiles((prev) => new Map(prev).set(filePath, file));
            setActiveFilePath(filePath);
          } else {
            // Handle error case
            const errorFile: ManagedFile = {
              path: filePath,
              content: '[IMAGE_ERROR]',
              originalContent: '[IMAGE_ERROR]',
              isDirty: false,
            };
            setOpenFiles((prev) => new Map(prev).set(filePath, errorFile));
            setActiveFilePath(filePath);
          }
          return;
        }

        // Load text file
        const result = await window.electronAPI.fsRead(taskPath, filePath);

        if (result.success && result.content !== undefined) {
          const file: ManagedFile = {
            path: filePath,
            content: result.content,
            originalContent: result.content,
            isDirty: false,
          };

          setOpenFiles((prev) => new Map(prev).set(filePath, file));
          setActiveFilePath(filePath);
        } else {
          console.error('Failed to load file:', result.error);
        }
      } catch (error) {
        console.error('Error loading file:', error);
      }
    },
    [taskPath, isImageFile]
  );

  /**
   * Save a file to disk
   */
  const saveFile = useCallback(
    async (filePath?: string) => {
      const targetPath = filePath || activeFilePath;
      if (!targetPath) return;

      const file = openFiles.get(targetPath);
      if (!file || !file.isDirty) return;

      setIsSaving(true);

      try {
        const result = await window.electronAPI.fsWriteFile(
          taskPath,
          targetPath,
          file.content,
          true
        );

        if (result.success) {
          setOpenFiles((prev) => {
            const next = new Map(prev);
            const updated = next.get(targetPath);
            if (updated) {
              updated.isDirty = false;
              updated.originalContent = updated.content;
            }
            return next;
          });

          // Dispatch file change event for immediate UI updates
          dispatchFileChangeEvent(taskPath, targetPath);

          // Notify parent component that file has changed (if callback provided)
          if (onFileChange) {
            // Add a small delay to ensure Git detects the change
            setTimeout(() => {
              onFileChange();
            }, 100);
          }
        } else {
          console.error('Failed to save:', result.error);
          alert(`Failed to save file: ${result.error}`);
        }
      } catch (error) {
        console.error('Error saving file:', error);
        alert(`Error saving file: ${error}`);
      } finally {
        setIsSaving(false);
      }
    },
    [activeFilePath, openFiles, taskPath, onFileChange]
  );

  /**
   * Save all dirty files
   */
  const saveAllFiles = useCallback(async () => {
    const dirtyFiles = Array.from(openFiles.entries()).filter(([_, file]) => file.isDirty);

    for (const [path] of dirtyFiles) {
      await saveFile(path);
    }
  }, [openFiles, saveFile]);

  /**
   * Update file content
   */
  const updateFileContent = useCallback((filePath: string, content: string) => {
    setOpenFiles((prev) => {
      const next = new Map(prev);
      const file = next.get(filePath);
      if (file) {
        file.content = content;
        file.isDirty = content !== file.originalContent;
      }
      return next;
    });
  }, []);

  /**
   * Close a file
   */
  const closeFile = useCallback(
    (filePath: string) => {
      setOpenFiles((prev) => {
        const next = new Map(prev);
        next.delete(filePath);
        return next;
      });

      if (activeFilePath === filePath) {
        const remaining = Array.from(openFiles.keys()).filter((p) => p !== filePath);
        setActiveFilePath(remaining[0] || null);
      }
    },
    [activeFilePath, openFiles]
  );

  /**
   * Set active file
   */
  const setActiveFile = useCallback((filePath: string | null) => {
    setActiveFilePath(filePath);
  }, []);

  /**
   * Auto-save effect
   */
  useEffect(() => {
    if (!autoSave || !activeFile?.isDirty) return;

    const timer = setTimeout(() => {
      saveFile();
    }, autoSaveDelay);

    return () => clearTimeout(timer);
  }, [activeFile?.content, activeFile?.isDirty, autoSave, autoSaveDelay, saveFile]);

  return {
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
  };
}
