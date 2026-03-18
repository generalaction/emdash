import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef } from 'react';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { codeEditorPool, type CodePoolEntry } from '@renderer/lib/monaco-code-pool';
import { configureMonacoEditor } from '@renderer/lib/monaco-config';

export interface PooledCodeEditorProps {
  activeFile: ManagedFile | null;
  modelRootPath: string;
  readOnly?: boolean;
  glyphMargin?: boolean;
  onEditorChange?: (value: string) => void;
  /**
   * Called once after the editor instance is leased and configured.
   * Use for task-specific setup: keyboard shortcuts, decorations, etc.
   * Return a cleanup function if teardown is needed on unmount.
   */
  onMount?: (
    editor: monacoNS.editor.IStandaloneCodeEditor,
    monaco: typeof monacoNS
  ) => (() => void) | void;
}

/**
 * Leases a Monaco IStandaloneCodeEditor instance from the global pool on mount
 * and returns it on unmount. File switches reuse cached models so unsaved edits
 * and undo history are preserved across tab changes.
 */
export function PooledCodeEditor({
  activeFile,
  modelRootPath,
  readOnly = false,
  glyphMargin = false,
  onEditorChange,
  onMount,
}: PooledCodeEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<CodePoolEntry | null>(null);
  const cancelledRef = useRef(false);
  const currentUriRef = useRef<string | null>(null);
  const { effectiveTheme } = useTheme();

  // Stable refs so effect closures always see current prop values without re-running.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const glyphMarginRef = useRef(glyphMargin);
  glyphMarginRef.current = glyphMargin;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const modelRootPathRef = useRef(modelRootPath);
  modelRootPathRef.current = modelRootPath;
  const onEditorChangeRef = useRef(onEditorChange);
  onEditorChangeRef.current = onEditorChange;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  // Apply global theme whenever it changes.
  useEffect(() => {
    codeEditorPool.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Mount: lease an editor, reparent its container, wire up models and listeners.
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    cancelledRef.current = false;

    codeEditorPool.lease().then((lease) => {
      if (cancelledRef.current) {
        codeEditorPool.release(lease);
        return;
      }

      leaseRef.current = lease;
      const editor = lease.editor;

      // Reparent the editor container into our mount div.
      mount.appendChild(lease.container);

      // Apply per-lease options before setting content.
      editor.updateOptions({
        readOnly: readOnlyRef.current,
        glyphMargin: glyphMarginRef.current,
      });

      // Per-lease setup that must be cleaned up on release.
      if (!readOnlyRef.current) {
        configureMonacoEditor(editor);
        const cleanupActiveEditor = registerActiveCodeEditor(editor);
        lease.disposables.push({ dispose: cleanupActiveEditor });
      }

      // Attach the model for the current active file.
      const file = activeFileRef.current;
      if (file) {
        const language = getMonacoLanguageId(file.path);
        const uri = codeEditorPool.applyFile(
          lease,
          modelRootPathRef.current,
          file.path,
          file.content,
          language
        );
        currentUriRef.current = uri;
      }

      editor.layout();

      // Subscribe to content changes — fires on every keystroke.
      const changeDisposable = editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        if (model) {
          onEditorChangeRef.current?.(model.getValue());
        }
      });
      lease.disposables.push(changeDisposable);

      // Caller-specific setup (keyboard shortcuts, decorations, etc.).
      const m = codeEditorPool.getMonaco();
      if (m) {
        const callerCleanup = onMountRef.current?.(editor, m as typeof monacoNS);
        if (callerCleanup) {
          lease.disposables.push({ dispose: callerCleanup });
        }
      }
    });

    return () => {
      cancelledRef.current = true;
      const lease = leaseRef.current;
      leaseRef.current = null;
      currentUriRef.current = null;
      if (lease) {
        codeEditorPool.release(lease);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync readOnly prop changes to the leased editor.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    lease.editor.updateOptions({ readOnly });
  }, [readOnly]);

  // Sync glyphMargin prop changes to the leased editor.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    lease.editor.updateOptions({ glyphMargin });
  }, [glyphMargin]);

  // Sync active file changes: switch the model, preserving view state.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease || !activeFile) return;

    const language = getMonacoLanguageId(activeFile.path);
    const previousUri = currentUriRef.current ?? undefined;
    const newUri = codeEditorPool.applyFile(
      lease,
      modelRootPath,
      activeFile.path,
      activeFile.content,
      language,
      previousUri
    );
    currentUriRef.current = newUri;
    lease.editor.layout();
  }, [activeFile?.path, modelRootPath]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} className="h-full w-full" />;
}
