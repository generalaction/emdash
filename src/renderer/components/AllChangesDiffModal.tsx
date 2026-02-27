import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, ChevronRight, AlertCircle, Copy, Check, FileText } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { type FileChange } from '../hooks/useFileChanges';
import type { DiffLine } from '../hooks/useFileDiff';
import {
  convertDiffLinesToMonacoFormat,
  getMonacoLanguageId,
  isBinaryFile,
} from '../lib/diffUtils';
import { dispatchFileChangeEvent } from '../lib/fileChangeEvents';
import { useToast } from '../hooks/use-toast';
import { MONACO_DIFF_COLORS } from '../lib/monacoDiffColors';
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../lib/monacoDiffConfig';
import { useTheme } from '../hooks/useTheme';
import { registerActiveCodeEditor } from '../lib/activeCodeEditor';
import { useTaskScope } from './TaskScopeContext';

// Thresholds for detecting large files that should not be rendered in all-changes modal
const LARGE_DIFF_LINE_THRESHOLD = 2500;
const LARGE_DIFF_CHAR_THRESHOLD = 300_000;

interface AllChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  taskPath?: string;
  files: FileChange[];
  onRefreshChanges?: () => Promise<void> | void;
  onOpenFile?: (filePath: string) => void;
  onToggleView?: () => void;
}

interface FileDiffData {
  original: string;
  modified: string;
  initialModified: string;
  language: string;
  loading: boolean;
  error: string | null;
  expanded: boolean;
  saving?: boolean;
  saveError?: string | null;
  isLargeFile?: boolean;
  largeFileReason?: 'line_count' | 'content_size' | 'truncated_read';
}

export const AllChangesDiffModal: React.FC<AllChangesDiffModalProps> = ({
  open,
  onClose,
  taskPath,
  files,
  onRefreshChanges,
  onOpenFile,
  onToggleView,
}) => {
  const { taskPath: scopedTaskPath } = useTaskScope();
  const resolvedTaskPath = taskPath ?? scopedTaskPath ?? '';
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const [fileData, setFileData] = useState<Map<string, FileDiffData>>(new Map());
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';
  const editorRefs = useRef<Map<string, monaco.editor.IStandaloneDiffEditor>>(new Map());
  const changeDisposables = useRef<Map<string, monaco.IDisposable>>(new Map());
  const activeEditorCleanupDisposables = useRef<Map<string, () => void>>(new Map());

  // Close on escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const updateFileData = (filePath: string, updater: (data: FileDiffData) => FileDiffData) => {
    setFileData((prev) => {
      const existing = prev.get(filePath);
      if (!existing) return prev;
      const next = new Map(prev);
      next.set(filePath, updater(existing));
      return next;
    });
  };

  useEffect(() => {
    return () => {
      changeDisposables.current.forEach((d) => {
        try {
          d.dispose();
        } catch {
          // ignore
        }
      });
      changeDisposables.current.clear();
      activeEditorCleanupDisposables.current.forEach((cleanup) => {
        try {
          cleanup();
        } catch {
          // ignore
        }
      });
      activeEditorCleanupDisposables.current.clear();
      editorRefs.current.clear();

      // Reset diagnostic options when closing modal
      loader
        .init()
        .then((monaco) => {
          resetDiagnosticOptions(monaco);
        })
        .catch(() => {
          // Ignore errors during cleanup
        });
    };
  }, []);

  const handleSave = async (filePath: string) => {
    const current = fileData.get(filePath);
    if (!current || current.loading || current.error || !resolvedTaskPath) return;
    updateFileData(filePath, (data) => ({ ...data, saving: true, saveError: null }));
    try {
      const res = await window.electronAPI.fsWriteFile(
        resolvedTaskPath,
        filePath,
        current.modified,
        true
      );
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save file');
      }
      updateFileData(filePath, (data) => ({
        ...data,
        initialModified: data.modified,
        saving: false,
        saveError: null,
      }));
      // Dispatch file change event to update editor
      dispatchFileChangeEvent(resolvedTaskPath, filePath);
      if (onRefreshChanges) {
        await onRefreshChanges();
      }
    } catch (error: any) {
      const message = error?.message || 'Failed to save file';
      updateFileData(filePath, (data) => ({ ...data, saving: false, saveError: message }));
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    }
  };

  // Load file data when modal opens or files change
  useEffect(() => {
    if (!open || files.length === 0 || !resolvedTaskPath) {
      setFileData(new Map());
      return;
    }

    const loadFileData = async (file: FileChange) => {
      const filePath = file.path;
      const language = getMonacoLanguageId(filePath);

      // Early detection: check line count before loading content
      const totalLineChanges = file.additions + file.deletions;
      const isLargeByLineCount = totalLineChanges > LARGE_DIFF_LINE_THRESHOLD;

      // Skip binary files
      if (isBinaryFile(filePath)) {
        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: '',
            modified: '',
            initialModified: '',
            language: 'plaintext',
            loading: false,
            error: 'Binary file - diff not available',
            expanded: true, // Default expanded
            isLargeFile: false,
          });
          return next;
        });
        return;
      }

      // Set loading state with large file detection
      setFileData((prev) => {
        const next = new Map(prev);
        next.set(filePath, {
          original: '',
          modified: '',
          initialModified: '',
          language,
          loading: true,
          error: null,
          expanded: !isLargeByLineCount, // Collapse large files by default
          isLargeFile: isLargeByLineCount,
          largeFileReason: isLargeByLineCount ? 'line_count' : undefined,
        });
        return next;
      });

      try {
        // Get diff lines
        if (!resolvedTaskPath) return;
        const diffRes = await window.electronAPI.getFileDiff({
          taskPath: resolvedTaskPath,
          filePath,
        });
        if (!diffRes?.success || !diffRes.diff) {
          throw new Error(diffRes?.error || 'Failed to load diff');
        }

        const diffLines: DiffLine[] = diffRes.diff.lines;

        // For deleted files, try to read original from git
        // For added files, read the current file
        // For modified files, we'll use the diff to reconstruct

        let originalContent = '';
        let modifiedContent = '';
        let isLargeFile = isLargeByLineCount;
        let largeFileReason: 'line_count' | 'content_size' | 'truncated_read' | undefined =
          isLargeByLineCount ? 'line_count' : undefined;

        if (file.status === 'deleted') {
          // Try to read from git (HEAD version)
          // For now, use diff lines to reconstruct original
          const converted = convertDiffLinesToMonacoFormat(diffLines);
          originalContent = converted.original;
          modifiedContent = '';
        } else if (file.status === 'added') {
          // Read current file content
          const readRes = await window.electronAPI.fsRead(
            resolvedTaskPath,
            filePath,
            2 * 1024 * 1024
          );
          if (readRes?.success && readRes.content) {
            modifiedContent = readRes.content;
            originalContent = '';
            // Check for truncated read
            if (readRes.truncated) {
              isLargeFile = true;
              largeFileReason = 'truncated_read';
            }
          } else {
            // Fallback: use diff lines
            const converted = convertDiffLinesToMonacoFormat(diffLines);
            originalContent = '';
            modifiedContent = converted.modified;
          }
        } else {
          // Modified file: reconstruct from diff
          const converted = convertDiffLinesToMonacoFormat(diffLines);
          originalContent = converted.original;
          modifiedContent = converted.modified;

          // Try to read actual current content for better accuracy
          try {
            const readRes = await window.electronAPI.fsRead(
              resolvedTaskPath,
              filePath,
              2 * 1024 * 1024
            );
            if (readRes?.success && readRes.content) {
              modifiedContent = readRes.content;
              // Check for truncated read
              if (readRes.truncated) {
                isLargeFile = true;
                largeFileReason = 'truncated_read';
              }
            }
          } catch {
            // Fallback to diff-based content
          }
        }

        // Check content size after loading
        const totalContentSize = originalContent.length + modifiedContent.length;
        if (!isLargeFile && totalContentSize > LARGE_DIFF_CHAR_THRESHOLD) {
          isLargeFile = true;
          largeFileReason = 'content_size';
        }

        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: originalContent,
            modified: modifiedContent,
            initialModified: modifiedContent,
            language,
            loading: false,
            error: null,
            expanded: !isLargeFile, // Collapse large files by default
            isLargeFile,
            largeFileReason,
          });
          return next;
        });
      } catch (error: any) {
        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: '',
            modified: '',
            initialModified: '',
            language,
            loading: false,
            error: error?.message || 'Failed to load file diff',
            expanded: !isLargeByLineCount, // Collapse large files even on error
            isLargeFile: isLargeByLineCount,
            largeFileReason: isLargeByLineCount ? 'line_count' : undefined,
          });
          return next;
        });
      }
    };

    // Load all files
    files.forEach((file) => {
      if (!fileData.has(file.path)) {
        loadFileData(file);
      }
    });
  }, [open, files, resolvedTaskPath]);

  // Add custom scrollbar styles and Monaco theme
  useEffect(() => {
    if (!open) return;

    const styleId = 'all-changes-modal-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      .all-changes-scrollable {
        scrollbar-width: thin;
        scrollbar-color: ${isDark ? 'rgba(156, 163, 175, 0.3)' : 'rgba(107, 114, 128, 0.3)'} transparent;
        padding-right: 7px; /* Add padding to move scrollbar left of overview ruler (3px ruler + 4px gap) */
      }
      .all-changes-scrollable::-webkit-scrollbar {
        width: 11px;
        height: 11px;
      }
      .all-changes-scrollable::-webkit-scrollbar-track {
        background: transparent;
      }
      .all-changes-scrollable::-webkit-scrollbar-thumb {
        background: ${isDark ? 'rgba(156, 163, 175, 0.3)' : 'rgba(107, 114, 128, 0.3)'};
        border-radius: 6px;
        border: 2.5px solid transparent;
        background-clip: padding-box;
        min-height: 20px;
      }
      .all-changes-scrollable::-webkit-scrollbar-thumb:hover {
        background: ${isDark ? 'rgba(156, 163, 175, 0.5)' : 'rgba(107, 114, 128, 0.5)'};
        background-clip: padding-box;
      }
      .all-changes-scrollable::-webkit-scrollbar-thumb:active {
        background: ${isDark ? 'rgba(156, 163, 175, 0.7)' : 'rgba(107, 114, 128, 0.7)'};
        background-clip: padding-box;
      }
      .all-changes-scrollable::-webkit-scrollbar-corner {
        background: transparent;
      }
      /* Override global scrollbar styles for modal */
      [data-all-changes-modal] *::-webkit-scrollbar {
        width: 11px !important;
        height: 11px !important;
      }
      [data-all-changes-modal] *::-webkit-scrollbar-track {
        background: transparent !important;
      }
      [data-all-changes-modal] *::-webkit-scrollbar-thumb {
        background: ${isDark ? 'rgba(156, 163, 175, 0.3)' : 'rgba(107, 114, 128, 0.3)'} !important;
        border-radius: 6px !important;
        border: 2.5px solid transparent !important;
        background-clip: padding-box !important;
      }
      [data-all-changes-modal] *::-webkit-scrollbar-thumb:hover {
        background: ${isDark ? 'rgba(156, 163, 175, 0.5)' : 'rgba(107, 114, 128, 0.5)'} !important;
        background-clip: padding-box !important;
      }
      /* Fix Monaco diff editor spacing */
      .monaco-diff-editor .diffViewport {
        padding-left: 0 !important;
      }
      /* Right-align line numbers and optimize spacing */
      .monaco-diff-editor .line-numbers {
        text-align: right !important;
        padding-right: 12px !important;
        padding-left: 4px !important;
        min-width: 40px !important;
      }
      /* Hide left/original line numbers in unified diff view */
      .monaco-diff-editor .original .line-numbers {
        display: none !important;
      }
      .monaco-diff-editor .original .margin {
        display: none !important;
      }
      /* Make overview ruler thinner */
      .monaco-diff-editor .monaco-editor .overview-ruler {
        width: 3px !important;
      }
      .monaco-diff-editor .monaco-editor .overview-ruler .overview-ruler-content {
        width: 3px !important;
      }
      /* Hide +/- indicators on the left sidebar - multiple selectors to ensure they're hidden */
      .monaco-diff-editor .margin-view-overlays .line-insert,
      .monaco-diff-editor .margin-view-overlays .line-delete,
      .monaco-diff-editor .margin-view-overlays .codicon-add,
      .monaco-diff-editor .margin-view-overlays .codicon-remove,
      .monaco-diff-editor .margin-view-overlays .codicon-diff-added,
      .monaco-diff-editor .margin-view-overlays .codicon-diff-removed {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
      }
      /* Add thin border between line numbers and code content */
      .monaco-diff-editor .modified .margin-view-overlays {
        border-right: 1px solid ${isDark ? 'rgba(156, 163, 175, 0.2)' : 'rgba(107, 114, 128, 0.2)'} !important;
      }
      .monaco-diff-editor .monaco-editor .margin {
        border-right: 1px solid ${isDark ? 'rgba(156, 163, 175, 0.2)' : 'rgba(107, 114, 128, 0.2)'} !important;
      }
      .monaco-diff-editor .monaco-editor-background {
        margin-left: 0 !important;
      }
      /* Hide Monaco's default scrollbar completely and use custom */
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar {
        margin: 0 !important;
        background: transparent !important;
      }
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar > .slider {
        background: transparent !important;
      }
      /* Apple-like scrollbar for Monaco editor - only show on hover */
      .monaco-diff-editor:hover .monaco-scrollable-element > .scrollbar > .slider {
        background: ${isDark ? 'rgba(156, 163, 175, 0.2)' : 'rgba(107, 114, 128, 0.2)'} !important;
        border-radius: 6px !important;
        border: 2.5px solid transparent !important;
        background-clip: padding-box !important;
      }
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar > .slider:hover {
        background: ${isDark ? 'rgba(156, 163, 175, 0.4)' : 'rgba(107, 114, 128, 0.4)'} !important;
        background-clip: padding-box !important;
      }
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar > .slider:active {
        background: ${isDark ? 'rgba(156, 163, 175, 0.6)' : 'rgba(107, 114, 128, 0.6)'} !important;
        background-clip: padding-box !important;
      }
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar.vertical {
        width: 4px !important;
        right: 0 !important;
      }
      .monaco-diff-editor .monaco-scrollable-element > .scrollbar.horizontal {
        height: 11px !important;
        bottom: 0 !important;
      }
      /* Hide any shadow or overlay from Monaco */
      .monaco-diff-editor .monaco-scrollable-element {
        box-shadow: none !important;
      }
      .monaco-diff-editor .overflow-guard {
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);

    // Define custom Monaco themes - simpler approach
    const defineThemes = async () => {
      try {
        const monaco = await loader.init();

        // Determine which colors to use based on theme
        const themeColors =
          effectiveTheme === 'dark-black'
            ? MONACO_DIFF_COLORS['dark-black']
            : effectiveTheme === 'dark'
              ? MONACO_DIFF_COLORS.dark
              : MONACO_DIFF_COLORS.light;

        // Dark theme with custom background
        monaco.editor.defineTheme('custom-diff-dark', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': MONACO_DIFF_COLORS.dark.editorBackground,
            'editorGutter.background': MONACO_DIFF_COLORS.dark.editorBackground,
            'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.dark.insertedTextBackground,
            'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.dark.insertedLineBackground,
            'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.dark.removedTextBackground,
            'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.dark.removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#1a2332', // Slightly darker for collapsed regions
          },
        });

        // Black theme with pure black background
        monaco.editor.defineTheme('custom-diff-black', {
          base: 'vs-dark',
          inherit: true,
          rules: [],
          colors: {
            'editor.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
            'editorGutter.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
            'diffEditor.insertedTextBackground':
              MONACO_DIFF_COLORS['dark-black'].insertedTextBackground,
            'diffEditor.insertedLineBackground':
              MONACO_DIFF_COLORS['dark-black'].insertedLineBackground,
            'diffEditor.removedTextBackground':
              MONACO_DIFF_COLORS['dark-black'].removedTextBackground,
            'diffEditor.removedLineBackground':
              MONACO_DIFF_COLORS['dark-black'].removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#0a0a0a', // Very dark gray for collapsed regions
          },
        });

        // Light theme - use default Monaco light theme
        monaco.editor.defineTheme('custom-diff-light', {
          base: 'vs',
          inherit: true,
          rules: [],
          colors: {
            'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.light.insertedTextBackground,
            'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.light.insertedLineBackground,
            'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.light.removedTextBackground,
            'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.light.removedLineBackground,
            'diffEditor.unchangedRegionBackground': '#e2e8f0', // slate-200 - slightly different grey for collapsed regions
          },
        });
      } catch (error) {
        console.warn('Failed to define Monaco themes:', error);
      }
    };
    defineThemes();

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, [open, isDark, effectiveTheme]);

  // Cleanup editors on unmount
  useEffect(() => {
    return () => {
      editorRefs.current.forEach((editor) => {
        try {
          editor.dispose();
        } catch {
          // Ignore disposal errors
        }
      });
      editorRefs.current.clear();
    };
  }, []);

  const toggleFileExpanded = (filePath: string) => {
    setFileData((prev) => {
      const next = new Map(prev);
      const current = next.get(filePath);
      if (current) {
        next.set(filePath, { ...current, expanded: !current.expanded });
      } else {
        // Initialize if not loaded yet
        next.set(filePath, {
          original: '',
          modified: '',
          initialModified: '',
          language: getMonacoLanguageId(filePath),
          loading: true,
          error: null,
          expanded: true,
          saving: false,
          saveError: null,
        });
      }
      return next;
    });
  };

  const handleCopyFile = async (filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopiedFile(filePath);
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedFile(null);
      }, 2000);
    } catch (error) {
      toast({
        title: 'Copy failed',
        description: 'Failed to copy file path',
        variant: 'destructive',
      });
    }
  };

  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  const handleEditorDidMount = async (
    filePath: string,
    editor: monaco.editor.IStandaloneDiffEditor
  ) => {
    editorRefs.current.set(filePath, editor);
    try {
      const modifiedEditor = editor.getModifiedEditor();
      activeEditorCleanupDisposables.current.get(filePath)?.();
      activeEditorCleanupDisposables.current.set(
        filePath,
        registerActiveCodeEditor(modifiedEditor)
      );
      changeDisposables.current.get(filePath)?.dispose();
      const disposable = modifiedEditor.onDidChangeModelContent(() => {
        const value = modifiedEditor.getValue() ?? '';
        updateFileData(filePath, (data) => ({
          ...data,
          modified: value,
          saveError: null,
        }));
      });
      changeDisposables.current.set(filePath, disposable);
    } catch {
      // best effort
    }

    // Define themes when editor is ready and FORCE apply theme
    try {
      const monaco = await loader.init();

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        // Find the editor that has focus
        for (const [path, editor] of editorRefs.current.entries()) {
          const modifiedEditor = editor.getModifiedEditor();
          if (modifiedEditor.hasTextFocus()) {
            handleSaveRef.current(path);
            return;
          }
        }
      });

      // Configure diagnostics to suppress warnings in diff viewer
      // Disabling all validation since diff viewer is read-only
      configureDiffEditorDiagnostics(editor, monaco, {
        disableAllValidation: true,
        suppressSpecificErrors: false,
      });

      // Define themes (safe to call multiple times)
      monaco.editor.defineTheme('custom-diff-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': MONACO_DIFF_COLORS.dark.editorBackground,
          'editorGutter.background': MONACO_DIFF_COLORS.dark.editorBackground,
          'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.dark.insertedTextBackground,
          'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.dark.insertedLineBackground,
          'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.dark.removedTextBackground,
          'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.dark.removedLineBackground,
          'diffEditor.unchangedRegionBackground': '#1a2332',
        },
      });

      // Black theme with pure black background
      monaco.editor.defineTheme('custom-diff-black', {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: {
          'editor.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
          'editorGutter.background': MONACO_DIFF_COLORS['dark-black'].editorBackground,
          'diffEditor.insertedTextBackground':
            MONACO_DIFF_COLORS['dark-black'].insertedTextBackground,
          'diffEditor.insertedLineBackground':
            MONACO_DIFF_COLORS['dark-black'].insertedLineBackground,
          'diffEditor.removedTextBackground':
            MONACO_DIFF_COLORS['dark-black'].removedTextBackground,
          'diffEditor.removedLineBackground':
            MONACO_DIFF_COLORS['dark-black'].removedLineBackground,
          'diffEditor.unchangedRegionBackground': '#0a0a0a',
        },
      });

      monaco.editor.defineTheme('custom-diff-light', {
        base: 'vs',
        inherit: true,
        rules: [],
        colors: {
          'diffEditor.insertedTextBackground': MONACO_DIFF_COLORS.light.insertedTextBackground,
          'diffEditor.insertedLineBackground': MONACO_DIFF_COLORS.light.insertedLineBackground,
          'diffEditor.removedTextBackground': MONACO_DIFF_COLORS.light.removedTextBackground,
          'diffEditor.removedLineBackground': MONACO_DIFF_COLORS.light.removedLineBackground,
          'diffEditor.unchangedRegionBackground': '#e2e8f0', // slate-200 - slightly different grey for collapsed regions
        },
      });
      // FORCE update theme based on current theme
      const currentTheme =
        effectiveTheme === 'dark-black'
          ? 'custom-diff-black'
          : effectiveTheme === 'dark'
            ? 'custom-diff-dark'
            : 'custom-diff-light';
      monaco.editor.setTheme(currentTheme);
    } catch (error) {
      console.warn('Failed to define Monaco themes:', error);
    }
  };

  const totalStats = useMemo(() => {
    return files.reduce(
      (acc, file) => ({
        additions: acc.additions + file.additions,
        deletions: acc.deletions + file.deletions,
      }),
      { additions: 0, deletions: 0 }
    );
  }, [files]);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          initial={shouldReduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={shouldReduceMotion ? { opacity: 1 } : { opacity: 0 }}
          transition={shouldReduceMotion ? { duration: 0 } : { duration: 0.12, ease: 'easeOut' }}
          onClick={onClose}
        >
          <motion.div
            onClick={(e) => e.stopPropagation()}
            initial={shouldReduceMotion ? false : { opacity: 0, y: 8, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={
              shouldReduceMotion
                ? { opacity: 1, y: 0, scale: 1 }
                : { opacity: 0, y: 6, scale: 0.995 }
            }
            transition={
              shouldReduceMotion ? { duration: 0 } : { duration: 0.2, ease: [0.22, 1, 0.36, 1] }
            }
            className="flex h-[92vh] w-[96vw] max-w-[1600px] transform-gpu overflow-hidden rounded-xl border border-border bg-muted shadow-2xl will-change-transform dark:border-border dark:bg-background"
            data-all-changes-modal="true"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border bg-muted px-5 py-3 dark:border-border dark:bg-background">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold text-foreground">All Changes</h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground dark:bg-muted/50 dark:text-muted-foreground">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        +{totalStats.additions}
                      </span>
                      <span className="text-muted-foreground">•</span>
                      <span className="font-medium text-rose-600 dark:text-rose-400">
                        -{totalStats.deletions}
                      </span>
                    </div>
                  </div>
                  {onToggleView && (
                    <button
                      onClick={onToggleView}
                      className="rounded-md px-3 py-1 text-sm font-normal text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
                    >
                      Stacked View
                    </button>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-muted-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-muted-foreground"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="all-changes-scrollable min-h-0 flex-1 overflow-y-auto">
                {files.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    No changes to display
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 pr-[7px] dark:divide-gray-800/50">
                    {files.map((file, index) => {
                      const data = fileData.get(file.path);
                      const isExpanded = data?.expanded ?? true; // Default to expanded
                      const isLoading = data?.loading ?? true;
                      const hasError = data?.error !== null;
                      const isDirty = data ? data.modified !== data.initialModified : false;
                      const isSaving = data?.saving ?? false;

                      return (
                        <div
                          key={file.path}
                          className={`${index === 0 ? '' : 'border-t border-border/50'} bg-muted`}
                        >
                          <div className="group flex items-center border-b border-border bg-muted dark:border-border/50 dark:bg-card">
                            <button
                              onClick={() => toggleFileExpanded(file.path)}
                              className="flex min-w-0 flex-1 items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-accent/50"
                            >
                              <div className="flex shrink-0 items-center">
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-muted-foreground dark:text-muted-foreground dark:group-hover:text-muted-foreground" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-muted-foreground dark:text-muted-foreground dark:group-hover:text-muted-foreground" />
                                )}
                              </div>
                              <span
                                className="truncate text-left font-mono text-sm font-medium text-foreground [direction:rtl]"
                                title={file.path}
                              >
                                {file.path}
                              </span>
                              {isDirty && (
                                <div
                                  className="h-1.5 w-1.5 rounded-full bg-blue-500"
                                  title="Unsaved changes"
                                />
                              )}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleCopyFile(file.path);
                                }}
                                className="ml-2 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-muted-foreground"
                                title="Copy file path"
                                aria-label="Copy file path"
                              >
                                {copiedFile === file.path ? (
                                  <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </button>
                              <div className="flex items-center gap-2 text-xs">
                                {file.additions > 0 && (
                                  <span className="font-medium text-emerald-600 dark:text-emerald-400">
                                    +{file.additions}
                                  </span>
                                )}
                                {file.deletions > 0 && (
                                  <span className="font-medium text-rose-600 dark:text-rose-400">
                                    -{file.deletions}
                                  </span>
                                )}
                              </div>
                            </button>
                          </div>
                          {!hasError && (isDirty || isSaving) && (
                            <div className="flex items-center justify-between px-5 py-2 text-xs text-muted-foreground">
                              <div className="flex items-center gap-2">
                                <span>{isDirty ? 'Unsaved changes' : 'No unsaved changes'}</span>
                                {data?.saveError ? (
                                  <span className="text-rose-500 dark:text-rose-400">
                                    • {data.saveError}
                                  </span>
                                ) : null}
                              </div>
                              <button
                                onClick={() => void handleSave(file.path)}
                                disabled={!isDirty || isSaving}
                                className={`inline-flex items-center rounded-md px-3 py-1 text-sm font-medium transition ${
                                  !isDirty || isSaving
                                    ? 'cursor-not-allowed bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground'
                                    : 'dark:bg-muted0 bg-muted text-white hover:bg-accent dark:hover:bg-muted'
                                }`}
                              >
                                {isSaving ? 'Saving…' : 'Save'}
                              </button>
                            </div>
                          )}

                          {isExpanded && (
                            <div className="border-b border-border bg-muted dark:border-border/50 dark:bg-background">
                              {isLoading ? (
                                <div className="flex h-64 items-center justify-center text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-gray-600 dark:border-border dark:border-t-gray-400"></div>
                                    <span className="text-sm">Loading diff...</span>
                                  </div>
                                </div>
                              ) : hasError ? (
                                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-muted-foreground">
                                  <AlertCircle className="h-6 w-6 text-rose-500 dark:text-rose-400" />
                                  <span className="text-sm">
                                    {data?.error || 'Failed to load diff'}
                                  </span>
                                </div>
                              ) : data?.isLargeFile ? (
                                <div className="flex h-64 flex-col items-center justify-center gap-4 px-4 text-muted-foreground">
                                  <div className="flex flex-col items-center gap-2">
                                    <AlertCircle className="h-8 w-8 text-amber-500 dark:text-amber-400" />
                                    <div className="text-center">
                                      <p className="text-sm font-medium text-foreground">
                                        File too large to render here
                                      </p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        {data.largeFileReason === 'line_count' &&
                                          `This file has ${file.additions + file.deletions} line changes.`}
                                        {data.largeFileReason === 'content_size' &&
                                          'This file exceeds the size limit for inline viewing.'}
                                        {data.largeFileReason === 'truncated_read' &&
                                          'This file is too large to read completely.'}
                                      </p>
                                      <p className="mt-1 text-xs text-muted-foreground">
                                        Open individually for better performance.
                                      </p>
                                    </div>
                                  </div>
                                  {onOpenFile && (
                                    <button
                                      onClick={() => {
                                        onOpenFile(file.path);
                                        onClose();
                                      }}
                                      className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
                                    >
                                      <FileText className="h-4 w-4" />
                                      Open in single-file diff
                                    </button>
                                  )}
                                </div>
                              ) : data ? (
                                <div className="relative h-[600px] min-h-[400px]">
                                  <DiffEditor
                                    height="600px"
                                    language={data.language}
                                    original={data.original}
                                    modified={data.modified}
                                    theme={isDark ? 'custom-diff-dark' : 'custom-diff-light'}
                                    options={{
                                      readOnly: false, // Allow edits on modified pane
                                      originalEditable: false,
                                      renderSideBySide: false, // Unified/inline view
                                      fontSize: 13,
                                      lineHeight: 20,
                                      minimap: { enabled: false }, // Disable minimap for cleaner look
                                      scrollBeyondLastLine: false,
                                      wordWrap: 'on',
                                      lineNumbers: 'on',
                                      lineNumbersMinChars: 2, // Reduce line number width for better space usage
                                      renderIndicators: false, // Hide +/- indicators
                                      overviewRulerLanes: 3, // Show overview ruler with change indicators
                                      renderOverviewRuler: true, // Show overview ruler
                                      automaticLayout: true,
                                      // Custom scrollbar settings - hide by default, show on hover
                                      scrollbar: {
                                        vertical: 'visible',
                                        horizontal: 'visible',
                                        useShadows: false,
                                        verticalScrollbarSize: 4,
                                        horizontalScrollbarSize: 4,
                                        arrowSize: 0,
                                        verticalHasArrows: false,
                                        horizontalHasArrows: false,
                                        alwaysConsumeMouseWheel: false,
                                        verticalSliderSize: 4,
                                        horizontalSliderSize: 4,
                                      },
                                      // Hide unchanged regions for cleaner view
                                      hideUnchangedRegions: {
                                        enabled: true,
                                      },
                                      // Better diff rendering
                                      diffWordWrap: 'on',
                                      enableSplitViewResizing: false,
                                      // Smooth scrolling
                                      smoothScrolling: true,
                                      cursorSmoothCaretAnimation: 'on',
                                      // Remove extra padding
                                      padding: { top: 8, bottom: 8 },
                                      // Spacing adjustments
                                      glyphMargin: false, // Disable glyph margin to reduce spacing
                                      lineDecorationsWidth: 16, // Width for +/- indicators
                                      folding: false, // Disable folding to reduce spacing
                                    }}
                                    onMount={(editor: monaco.editor.IStandaloneDiffEditor) =>
                                      handleEditorDidMount(file.path, editor)
                                    }
                                  />
                                </div>
                              ) : null}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default AllChangesDiffModal;
