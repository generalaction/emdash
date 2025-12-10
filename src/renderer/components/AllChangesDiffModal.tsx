import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronDown, ChevronRight, AlertCircle, Copy, Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { type FileChange } from '../hooks/useFileChanges';
import type { DiffLine } from '../hooks/useFileDiff';
import { convertDiffLinesToMonacoFormat, getMonacoLanguageId, isBinaryFile } from '../lib/diffUtils';
import { useToast } from '../hooks/use-toast';
import { MONACO_DIFF_COLORS } from '../lib/monacoDiffColors';
import { useTheme } from '../hooks/useTheme';

interface AllChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  workspacePath: string;
  files: FileChange[];
  onRefreshChanges?: () => Promise<void> | void;
}

interface FileDiffData {
  original: string;
  modified: string;
  language: string;
  loading: boolean;
  error: string | null;
  expanded: boolean;
}

export const AllChangesDiffModal: React.FC<AllChangesDiffModalProps> = ({
  open,
  onClose,
  workspacePath,
  files,
  onRefreshChanges,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const [fileData, setFileData] = useState<Map<string, FileDiffData>>(new Map());
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const isDark = effectiveTheme === 'dark';
  const editorRefs = useRef<Map<string, monaco.editor.IStandaloneDiffEditor>>(new Map());

  // Load file data when modal opens or files change
  useEffect(() => {
    if (!open || files.length === 0) {
      setFileData(new Map());
      return;
    }

    const loadFileData = async (file: FileChange) => {
      const filePath = file.path;
      const language = getMonacoLanguageId(filePath);

      // Skip binary files
      if (isBinaryFile(filePath)) {
        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: '',
            modified: '',
            language: 'plaintext',
            loading: false,
            error: 'Binary file - diff not available',
            expanded: true, // Default expanded
          });
          return next;
        });
        return;
      }

      // Set loading state
      setFileData((prev) => {
        const next = new Map(prev);
        next.set(filePath, {
          original: '',
          modified: '',
          language,
          loading: true,
          error: null,
          expanded: true, // Default expanded
        });
        return next;
      });

      try {
        // Get diff lines
        const diffRes = await window.electronAPI.getFileDiff({ workspacePath, filePath });
        if (!diffRes?.success || !diffRes.diff) {
          throw new Error(diffRes?.error || 'Failed to load diff');
        }

        const diffLines: DiffLine[] = diffRes.diff.lines;

        // For deleted files, try to read original from git
        // For added files, read the current file
        // For modified files, we'll use the diff to reconstruct

        let originalContent = '';
        let modifiedContent = '';

        if (file.status === 'deleted') {
          // Try to read from git (HEAD version)
          // For now, use diff lines to reconstruct original
          const converted = convertDiffLinesToMonacoFormat(diffLines);
          originalContent = converted.original;
          modifiedContent = '';
        } else if (file.status === 'added') {
          // Read current file content
          const readRes = await window.electronAPI.fsRead(workspacePath, filePath, 2 * 1024 * 1024);
          if (readRes?.success && readRes.content) {
            modifiedContent = readRes.content;
            originalContent = '';
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
            const readRes = await window.electronAPI.fsRead(workspacePath, filePath, 2 * 1024 * 1024);
            if (readRes?.success && readRes.content) {
              modifiedContent = readRes.content;
            }
          } catch {
            // Fallback to diff-based content
          }
        }

        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: originalContent,
            modified: modifiedContent,
            language,
            loading: false,
            error: null,
            expanded: true, // Default expanded
          });
          return next;
        });
      } catch (error: any) {
        setFileData((prev) => {
          const next = new Map(prev);
          next.set(filePath, {
            original: '',
            modified: '',
            language,
            loading: false,
            error: error?.message || 'Failed to load file diff',
            expanded: true, // Default expanded even on error
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
  }, [open, files, workspacePath]);

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
  }, [open, isDark]);


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
          language: getMonacoLanguageId(filePath),
          loading: true,
          error: null,
          expanded: true,
        });
      }
      return next;
    });
  };

  const handleCopyFile = async (filePath: string) => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopiedFile(filePath);
      toast({
        title: 'Copied',
        description: `File path copied to clipboard`,
      });
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


  const handleEditorDidMount = async (
    filePath: string,
    editor: monaco.editor.IStandaloneDiffEditor
  ) => {
    editorRefs.current.set(filePath, editor);

    // Define themes when editor is ready and FORCE apply theme
    try {
      const monaco = await loader.init();
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
      // FORCE update theme
      const currentTheme = isDark ? 'custom-diff-dark' : 'custom-diff-light';
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
            className="flex h-[92vh] w-[96vw] max-w-[1600px] transform-gpu overflow-hidden rounded-xl border border-gray-200 bg-gray-50 shadow-2xl will-change-transform dark:border-gray-700 dark:bg-gray-900"
            data-all-changes-modal="true"
          >
            <div className="flex min-w-0 flex-1 flex-col">
              {/* Header */}
              <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-5 py-3 dark:border-gray-700 dark:bg-gray-900">
                <div className="flex items-center gap-4">
                  <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                    All Changes
                  </h2>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700/50 dark:text-gray-400">
                      {files.length} {files.length === 1 ? 'file' : 'files'}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-emerald-600 dark:text-emerald-400">
                        +{totalStats.additions}
                      </span>
                      <span className="text-gray-400">•</span>
                      <span className="font-medium text-rose-600 dark:text-rose-400">
                        -{totalStats.deletions}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Scrollable content */}
              <div className="all-changes-scrollable min-h-0 flex-1 overflow-y-auto">
                {files.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                    No changes to display
                  </div>
                ) : (
                  <div className="divide-y divide-gray-100 dark:divide-gray-800/50 pr-[7px]">
                    {files.map((file, index) => {
                      const data = fileData.get(file.path);
                      const isExpanded = data?.expanded ?? true; // Default to expanded
                      const isLoading = data?.loading ?? true;
                      const hasError = data?.error !== null;

                      return (
                        <div
                          key={file.path}
                          className={`${
                            index === 0 ? '' : 'border-t border-gray-200 dark:border-gray-700/50'
                          } bg-gray-50 dark:bg-gray-900`}
                        >
                          {/* File header */}
                          <div className="group flex items-center border-b border-gray-200 bg-gray-100 dark:border-gray-700/50 dark:bg-gray-800">
                            <button
                              onClick={() => toggleFileExpanded(file.path)}
                              className="flex min-w-0 flex-1 items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-gray-200 dark:hover:bg-gray-700/50"
                            >
                              <div className="flex shrink-0 items-center">
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-400" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5 text-gray-400 transition-colors group-hover:text-gray-600 dark:text-gray-500 dark:group-hover:text-gray-400" />
                                )}
                              </div>
                              <span className="truncate font-mono text-sm font-medium text-gray-900 dark:text-gray-100">
                                {file.path}
                              </span>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void handleCopyFile(file.path);
                                }}
                                className="ml-2 rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
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

                          {/* File diff content */}
                          {isExpanded && (
                            <div className="border-b border-gray-200 bg-gray-50 dark:border-gray-700/50 dark:bg-gray-900">
                              {isLoading ? (
                                <div className="flex h-64 items-center justify-center text-gray-500 dark:text-gray-400">
                                  <div className="flex items-center gap-2">
                                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-400"></div>
                                    <span className="text-sm">Loading diff...</span>
                                  </div>
                                </div>
                              ) : hasError ? (
                                <div className="flex h-64 flex-col items-center justify-center gap-2 px-4 text-gray-500 dark:text-gray-400">
                                  <AlertCircle className="h-6 w-6 text-rose-500 dark:text-rose-400" />
                                  <span className="text-sm">{data?.error || 'Failed to load diff'}</span>
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
                                      readOnly: true, // Read-only view
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
