import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Copy, Check } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { type FileChange } from '../hooks/useFileChanges';
import { useToast } from '../hooks/use-toast';
import { useTheme } from '../hooks/useTheme';
import type { DiffLine } from '../hooks/useFileDiff';
import {
  convertDiffLinesToMonacoFormat,
  getMonacoLanguageId,
  isBinaryFile,
} from '../lib/diffUtils';
import { MONACO_DIFF_COLORS } from '../lib/monacoDiffColors';

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  taskPath: string;
  files: FileChange[];
  initialFile?: string;
  onRefreshChanges?: () => Promise<void> | void;
}

export const ChangesDiffModal: React.FC<ChangesDiffModalProps> = ({
  open,
  onClose,
  taskPath,
  files,
  initialFile,
  onRefreshChanges,
}) => {
  const [selected, setSelected] = useState<string | undefined>(initialFile || files[0]?.path);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark';
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);

  // File data state for Monaco editor
  const [fileData, setFileData] = useState<{
    original: string;
    modified: string;
    language: string;
    loading: boolean;
    error: string | null;
  } | null>(null);

  // Load file data when selected file changes
  useEffect(() => {
    if (!open || !selected) {
      setFileData(null);
      return;
    }

    let cancelled = false;

    const loadFileData = async () => {
      // Find file from current files array (but don't depend on it in useEffect)
      const selectedFile = files.find((f) => f.path === selected);
      if (!selectedFile) {
        if (!cancelled) {
          setFileData({
            original: '',
            modified: '',
            language: 'plaintext',
            loading: false,
            error: 'File not found',
          });
        }
        return;
      }

      const filePath = selectedFile.path;
      const language = getMonacoLanguageId(filePath);

      // Skip binary files
      if (isBinaryFile(filePath)) {
        setFileData({
          original: '',
          modified: '',
          language: 'plaintext',
          loading: false,
          error: 'Binary file - diff not available',
        });
        return;
      }

      // Set loading state
      setFileData({
        original: '',
        modified: '',
        language,
        loading: true,
        error: null,
      });

      try {
        // Get diff lines
        const diffRes = await window.electronAPI.getFileDiff({ taskPath, filePath });
        if (!diffRes?.success || !diffRes.diff) {
          throw new Error(diffRes?.error || 'Failed to load diff');
        }

        const diffLines: DiffLine[] = diffRes.diff.lines;

        let originalContent = '';
        let modifiedContent = '';

        if (selectedFile.status === 'deleted') {
          const converted = convertDiffLinesToMonacoFormat(diffLines);
          originalContent = converted.original;
          modifiedContent = '';
        } else if (selectedFile.status === 'added') {
          const readRes = await window.electronAPI.fsRead(taskPath, filePath, 2 * 1024 * 1024);
          if (readRes?.success && readRes.content) {
            modifiedContent = readRes.content;
            originalContent = '';
          } else {
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
              taskPath,
              filePath,
              2 * 1024 * 1024
            );
            if (readRes?.success && readRes.content) {
              modifiedContent = readRes.content;
            }
          } catch {
            // Fallback to diff-based content
          }
        }

        if (!cancelled) {
          setFileData({
            original: originalContent,
            modified: modifiedContent,
            language,
            loading: false,
            error: null,
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          setFileData({
            original: '',
            modified: '',
            language,
            loading: false,
            error: error?.message || 'Failed to load file diff',
          });
        }
      }
    };

    loadFileData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, taskPath]); // Removed 'files' to prevent constant reloading - files array changes every 5s

  // Add Monaco theme and styles
  useEffect(() => {
    if (!open) return;

    const styleId = 'changes-diff-modal-styles';
    if (document.getElementById(styleId)) return;

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
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
      /* Add padding between line numbers and code content border */
      .monaco-diff-editor .monaco-editor .margin {
        padding-right: 8px !important;
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
      /* Hide +/- indicators */
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
      /* Hide Monaco's default scrollbar and use custom */
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
        height: 4px !important;
        bottom: 0 !important;
      }
      .monaco-diff-editor .monaco-scrollable-element {
        box-shadow: none !important;
      }
      .monaco-diff-editor .overflow-guard {
        box-shadow: none !important;
      }
    `;
    document.head.appendChild(style);

    // Define Monaco themes
    const defineThemes = async () => {
      try {
        const monaco = await loader.init();
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
            'diffEditor.unchangedRegionBackground': '#e2e8f0',
          },
        });
        const currentTheme = isDark ? 'custom-diff-dark' : 'custom-diff-light';
        monaco.editor.setTheme(currentTheme);
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

  // Cleanup editor on unmount
  useEffect(() => {
    return () => {
      if (editorRef.current) {
        try {
          editorRef.current.dispose();
        } catch {
          // Ignore disposal errors
        }
        editorRef.current = null;
      }
    };
  }, []);

  const handleEditorDidMount = async (editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;

    // Define themes when editor is ready
    try {
      const monaco = await loader.init();
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
          'diffEditor.unchangedRegionBackground': '#e2e8f0',
        },
      });
      const currentTheme = isDark ? 'custom-diff-dark' : 'custom-diff-light';
      monaco.editor.setTheme(currentTheme);
    } catch (error) {
      console.warn('Failed to define Monaco themes:', error);
    }
  };

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
            className="flex h-[82vh] w-[92vw] transform-gpu overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl will-change-transform dark:border-gray-700 dark:bg-gray-800"
          >
            {/* Left sidebar - file list */}
            <div className="w-72 overflow-y-auto border-r border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="px-3 py-2 text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Changed Files
              </div>
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full border-b border-gray-200 px-3 py-2 text-left text-sm hover:bg-gray-100 dark:border-gray-800 dark:hover:bg-gray-700 ${
                    selected === f.path
                      ? 'bg-gray-100 text-gray-900 dark:bg-gray-700 dark:text-gray-100'
                      : 'text-gray-700 dark:text-gray-300'
                  }`}
                  onClick={() => setSelected(f.path)}
                >
                  <div className="truncate font-medium">{f.path}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    {f.status} • +{f.additions} / -{f.deletions}
                  </div>
                </button>
              ))}
            </div>

            {/* Right side - Monaco diff editor */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-gray-200 bg-white/80 px-4 py-2.5 dark:border-gray-700 dark:bg-gray-900/50">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate font-mono text-sm text-gray-700 dark:text-gray-200">
                    {selected}
                  </span>
                  {selected && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selected);
                          setCopiedFile(selected);
                          toast({
                            title: 'Copied',
                            description: `File path copied to clipboard`,
                          });
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
                      }}
                      className="rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                      title="Copy file path"
                      aria-label="Copy file path"
                    >
                      {copiedFile === selected ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
                <button
                  onClick={onClose}
                  className="rounded-md p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="relative flex-1 overflow-hidden">
                {fileData?.loading ? (
                  <div className="flex h-full items-center justify-center text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-600 dark:border-gray-600 dark:border-t-gray-400"></div>
                      <span className="text-sm">Loading diff...</span>
                    </div>
                  </div>
                ) : fileData?.error ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-gray-500 dark:text-gray-400">
                    <span className="text-sm">{fileData.error}</span>
                  </div>
                ) : fileData ? (
                  <>
                    <div className="h-full">
                      <DiffEditor
                        height="100%"
                        language={fileData.language}
                        original={fileData.original}
                        modified={fileData.modified}
                        theme={isDark ? 'custom-diff-dark' : 'custom-diff-light'}
                        options={{
                          readOnly: true,
                          renderSideBySide: false, // Unified/inline view
                          fontSize: 13,
                          lineHeight: 20,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: 'on',
                          lineNumbers: 'on',
                          lineNumbersMinChars: 2,
                          renderIndicators: false, // Hide +/- indicators
                          overviewRulerLanes: 3, // Show overview ruler with change indicators
                          renderOverviewRuler: true, // Show overview ruler
                          automaticLayout: true,
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
                          hideUnchangedRegions: {
                            enabled: true,
                          },
                          diffWordWrap: 'on',
                          enableSplitViewResizing: false,
                          smoothScrolling: true,
                          cursorSmoothCaretAnimation: 'on',
                          padding: { top: 8, bottom: 8 },
                          glyphMargin: false,
                          lineDecorationsWidth: 16,
                          folding: false,
                        }}
                        onMount={handleEditorDidMount}
                      />
                    </div>
                  </>
                ) : null}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
};

export default ChangesDiffModal;
