import React, { useEffect, useRef, useState } from 'react';
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
import { configureDiffEditorDiagnostics, resetDiagnosticOptions } from '../lib/monacoDiffConfig';
import { dispatchFileChangeEvent } from '../lib/fileChangeEvents';
import { useDiffEditorComments } from '../hooks/useDiffEditorComments';
import { useTaskComments } from '../hooks/useLineComments';
import { registerActiveCodeEditor } from '../lib/activeCodeEditor';
import { useTaskScope } from './TaskScopeContext';

interface ChangesDiffModalProps {
  open: boolean;
  onClose: () => void;
  taskId?: string;
  taskPath?: string;
  files: FileChange[];
  initialFile?: string;
  onRefreshChanges?: () => Promise<void> | void;
  onToggleView?: () => void;
}

export const ChangesDiffModal: React.FC<ChangesDiffModalProps> = ({
  open,
  onClose,
  taskId,
  taskPath,
  files,
  initialFile,
  onRefreshChanges,
  onToggleView,
}) => {
  const { taskId: scopedTaskId, taskPath: scopedTaskPath } = useTaskScope();
  const resolvedTaskId = taskId ?? scopedTaskId;
  const resolvedTaskPath = taskPath ?? scopedTaskPath;
  const safeTaskId = resolvedTaskId ?? '';
  const safeTaskPath = resolvedTaskPath ?? '';

  const [selected, setSelected] = useState<string | undefined>(initialFile || files[0]?.path);
  const [copiedFile, setCopiedFile] = useState<string | null>(null);
  const shouldReduceMotion = useReducedMotion();
  const { toast } = useToast();
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === 'dark' || effectiveTheme === 'dark-black';
  const [editorInstance, setEditorInstance] = useState<monaco.editor.IStandaloneDiffEditor | null>(
    null
  );
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  const changeDisposableRef = useRef<monaco.IDisposable | null>(null);
  const activeEditorCleanupRef = useRef<(() => void) | null>(null);

  // Integrate line comments - use state (not ref) so hook re-runs when editor mounts
  useDiffEditorComments({
    editor: editorInstance,
    taskId: safeTaskId,
    filePath: selected || '',
  });

  // Get comment counts for all files in this task (for sidebar display)
  const { countsByFile: commentCounts } = useTaskComments(safeTaskId);

  // File data state for Monaco editor
  const [fileData, setFileData] = useState<{
    original: string;
    modified: string;
    initialModified: string;
    language: string;
    loading: boolean;
    error: string | null;
  } | null>(null);
  const [modifiedDraft, setModifiedDraft] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Close on escape key
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Load file data when selected file changes
  useEffect(() => {
    if (!open || !selected || !safeTaskPath) {
      setFileData(null);
      setModifiedDraft('');
      setSaveError(null);
      setIsSaving(false);
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
            initialModified: '',
            language: 'plaintext',
            loading: false,
            error: 'File not found',
          });
          setModifiedDraft('');
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
          initialModified: '',
          language: 'plaintext',
          loading: false,
          error: 'Binary file - diff not available',
        });
        setModifiedDraft('');
        return;
      }

      // Set loading state
      setFileData({
        original: '',
        modified: '',
        initialModified: '',
        language,
        loading: true,
        error: null,
      });
      setModifiedDraft('');

      try {
        // Get diff lines
        if (!safeTaskPath) return;
        const diffRes = await window.electronAPI.getFileDiff({ taskPath: safeTaskPath, filePath });
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
          const readRes = await window.electronAPI.fsRead(safeTaskPath, filePath, 2 * 1024 * 1024);
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
              safeTaskPath,
              filePath,
              2 * 1024 * 1024
            );
            if (readRes?.success && readRes.content) {
              // Strip one trailing newline to prevent phantom newline in diff view
              modifiedContent = readRes.content.replace(/\n$/, '');
            }
          } catch {
            // Fallback to diff-based content
          }
        }

        if (!cancelled) {
          setFileData({
            original: originalContent,
            modified: modifiedContent,
            initialModified: modifiedContent,
            language,
            loading: false,
            error: null,
          });
          setModifiedDraft(modifiedContent);
          setSaveError(null);
          setIsSaving(false);
        }
      } catch (error: any) {
        if (!cancelled) {
          setFileData({
            original: '',
            modified: '',
            initialModified: '',
            language,
            loading: false,
            error: error?.message || 'Failed to load file diff',
          });
          setModifiedDraft('');
          setSaveError(error?.message || 'Failed to load file diff');
        }
      }
    };

    loadFileData();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, selected, safeTaskPath]); // Removed 'files' to prevent constant reloading - files array changes every 5s

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
      /* Hide diff viewport indicator (the grey bar in overview ruler) */
      .monaco-diff-editor .diffViewport {
        display: none !important;
      }
      .monaco-diff-editor .monaco-scrollable-element {
        box-shadow: none !important;
      }
      .monaco-diff-editor .overflow-guard {
        box-shadow: none !important;
      }
      /* Hover indicator for adding comments (plus icon) - shown dynamically via decoration */
      /* Icon only appears when mouse is in gutter area (via JS), so always use active color */
      .comment-hover-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 22px;
        height: 22px;
        margin: 1px auto;
        border-radius: 6px;
        border: 1px solid transparent;
        background: transparent;
        box-sizing: border-box;
        cursor: pointer;
        pointer-events: auto;
        transition: background-color 0.15s ease, border-color 0.15s ease;
      }
      .comment-hover-icon::before {
        content: '';
        display: block;
        width: 12px;
        height: 12px;
        background-color: hsl(var(--muted-foreground));
        mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cline x1='12' y1='5' x2='12' y2='19'%3E%3C/line%3E%3Cline x1='5' y1='12' x2='19' y2='12'%3E%3C/line%3E%3C/svg%3E");
        mask-size: contain;
        mask-repeat: no-repeat;
        mask-position: center;
      }
      .comment-hover-icon:hover,
      .comment-hover-icon.comment-hover-icon-pinned {
        background-color: hsl(var(--foreground) / 0.08);
        border-color: hsl(var(--border));
      }
      .comment-hover-icon:hover::before,
      .comment-hover-icon.comment-hover-icon-pinned::before {
        background-color: hsl(var(--foreground));
      }
      /* Remove any borders from glyph margin items */
      .monaco-editor .glyph-margin > div {
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
      }
      /* Remove borders from diff editor revert/undo decorations */
      .monaco-diff-editor .margin-view-overlays .cgmr,
      .monaco-diff-editor .margin-view-overlays .codicon,
      .monaco-diff-editor .glyph-margin-widgets .codicon,
      .monaco-diff-editor .line-decorations .codicon,
      .monaco-diff-editor .margin-view-overlays [class*="codicon-"] {
        border: none !important;
        outline: none !important;
        box-shadow: none !important;
      }
      .monaco-diff-editor .dirty-diff-deleted-indicator,
      .monaco-diff-editor .dirty-diff-modified-indicator,
      .monaco-diff-editor .dirty-diff-added-indicator {
        border: none !important;
        box-shadow: none !important;
      }
      /* Hide the revert arrow that shows on hover in diff gutter */
      .monaco-diff-editor .glyph-margin .codicon-arrow-left,
      .monaco-diff-editor .glyph-margin .codicon-discard {
        display: none !important;
      }
      /* Ensure view zones (comment widgets) are interactive */
      .monaco-editor .view-zones {
        pointer-events: auto !important;
      }
      .monaco-editor .view-zone {
        pointer-events: auto !important;
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
            'diffEditor.unchangedRegionBackground': '#e2e8f0',
          },
        });

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
    defineThemes();

    return () => {
      const existingStyle = document.getElementById(styleId);
      if (existingStyle) {
        existingStyle.remove();
      }
    };
  }, [open, isDark, effectiveTheme]);

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
      try {
        changeDisposableRef.current?.dispose();
      } catch {
        // ignore
      }
      changeDisposableRef.current = null;
      try {
        activeEditorCleanupRef.current?.();
      } catch {
        // ignore
      }
      activeEditorCleanupRef.current = null;

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

  const handleEditorDidMount = async (editor: monaco.editor.IStandaloneDiffEditor) => {
    editorRef.current = editor;
    setEditorInstance(editor); // Trigger re-render so useDiffEditorComments sees the editor
    try {
      activeEditorCleanupRef.current?.();
    } catch {
      // ignore
    }
    activeEditorCleanupRef.current = registerActiveCodeEditor(editor.getModifiedEditor());

    // Define themes when editor is ready
    try {
      const monaco = await loader.init();

      // Add Save Command (Cmd+S / Ctrl+S)
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSaveRef.current();
      });

      // Configure diagnostics to suppress warnings in diff viewer
      // Disabling all validation since diff viewer is read-only
      configureDiffEditorDiagnostics(editor, monaco, {
        disableAllValidation: true,
        suppressSpecificErrors: false,
      });
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
          'diffEditor.unchangedRegionBackground': '#e2e8f0',
        },
      });
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

    try {
      const modifiedEditor = editor.getModifiedEditor();
      changeDisposableRef.current?.dispose();
      changeDisposableRef.current = modifiedEditor.onDidChangeModelContent(() => {
        const value = modifiedEditor.getValue() ?? '';
        setModifiedDraft(value);
        setSaveError(null);
      });
    } catch {
      // best effort
    }
  };

  const handleSave = async () => {
    if (!selected || !fileData || !safeTaskPath) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const res = await window.electronAPI.fsWriteFile(safeTaskPath, selected, modifiedDraft, true);
      if (!res?.success) {
        throw new Error(res?.error || 'Failed to save file');
      }
      setFileData((prev) =>
        prev
          ? {
              ...prev,
              modified: modifiedDraft,
              initialModified: modifiedDraft,
            }
          : prev
      );
      // Dispatch file change event to update editor
      dispatchFileChangeEvent(safeTaskPath, selected);
      if (onRefreshChanges) {
        await onRefreshChanges();
      }
    } catch (error: any) {
      const message = error?.message || 'Failed to save file';
      setSaveError(message);
      toast({
        title: 'Save failed',
        description: message,
        variant: 'destructive',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Keep a ref to the latest handleSave callback so it can be used in listeners
  const handleSaveRef = useRef(handleSave);
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  const isDirty = fileData ? modifiedDraft !== fileData.initialModified : false;

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
            className="flex h-[82vh] w-[92vw] transform-gpu overflow-hidden rounded-xl border border-border bg-white shadow-2xl will-change-transform dark:border-border dark:bg-card"
          >
            <div className="w-72 overflow-y-auto border-r border-border bg-muted dark:border-border dark:bg-muted/40">
              <div className="px-3 py-2 text-xs tracking-wide text-muted-foreground">
                Changed Files
              </div>
              {files.map((f) => (
                <button
                  key={f.path}
                  className={`w-full border-b border-border px-3 py-2 text-left text-sm dark:border-border ${
                    selected === f.path
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-accent/50'
                  }`}
                  onClick={() => setSelected(f.path)}
                >
                  <div className="flex min-w-0 items-center gap-1">
                    <div className="truncate text-left font-medium [direction:rtl]" title={f.path}>
                      {f.path}
                    </div>
                    {selected === f.path && isDirty && (
                      <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {f.status} • +{f.additions} / -{f.deletions}
                    {commentCounts[f.path] > 0 && (
                      <span className="text-blue-600 dark:text-blue-400">
                        {' '}
                        • {commentCounts[f.path]}{' '}
                        {commentCounts[f.path] === 1 ? 'comment' : 'comments'}
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center justify-between border-b border-border bg-white/80 px-4 py-2.5 dark:border-border dark:bg-muted/50">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                    <span
                      className="truncate text-left font-mono text-sm text-foreground [direction:rtl]"
                      title={selected ?? undefined}
                    >
                      {selected}
                    </span>
                    {isDirty && (
                      <div className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-blue-500" />
                    )}
                  </div>
                  {selected && (
                    <button
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(selected);
                          setCopiedFile(selected);
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
                      className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-muted-foreground"
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
                  {onToggleView && (
                    <button
                      onClick={onToggleView}
                      className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:text-muted-foreground dark:hover:bg-accent dark:hover:text-foreground"
                    >
                      File View
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {(isDirty || isSaving) && !fileData?.error && (
                    <button
                      onClick={handleSave}
                      disabled={!isDirty || isSaving}
                      className={`inline-flex items-center rounded-md px-3 py-1 text-sm font-medium transition ${
                        !isDirty || isSaving
                          ? 'cursor-not-allowed bg-muted text-muted-foreground dark:bg-muted dark:text-muted-foreground'
                          : 'dark:bg-muted0 bg-muted text-white hover:bg-accent dark:hover:bg-muted'
                      }`}
                    >
                      {isSaving ? 'Saving…' : 'Save'}
                    </button>
                  )}
                  <button
                    onClick={onClose}
                    className="rounded-md p-1 text-muted-foreground hover:bg-muted dark:text-muted-foreground dark:hover:bg-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="relative flex-1 overflow-hidden">
                {fileData?.loading ? (
                  <div className="flex h-full items-center justify-center text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-border border-t-gray-600 dark:border-border dark:border-t-gray-400"></div>
                      <span className="text-sm">Loading diff...</span>
                    </div>
                  </div>
                ) : fileData?.error ? (
                  <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-muted-foreground">
                    <span className="text-sm">{fileData.error}</span>
                  </div>
                ) : fileData ? (
                  <>
                    <div className="h-full">
                      <DiffEditor
                        height="100%"
                        language={fileData.language}
                        original={fileData.original}
                        modified={modifiedDraft}
                        theme={isDark ? 'custom-diff-dark' : 'custom-diff-light'}
                        options={{
                          readOnly: false,
                          originalEditable: false,
                          renderSideBySide: false, // Unified/inline view
                          fontSize: 13,
                          lineHeight: 20,
                          minimap: { enabled: false },
                          scrollBeyondLastLine: false,
                          wordWrap: 'on',
                          lineNumbers: 'on',
                          lineNumbersMinChars: 2,
                          renderIndicators: false, // Hide +/- indicators
                          overviewRulerLanes: 3,
                          renderOverviewRuler: true,
                          overviewRulerBorder: false,
                          automaticLayout: true,
                          scrollbar: {
                            vertical: 'auto',
                            horizontal: 'auto',
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
                          glyphMargin: true,
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
