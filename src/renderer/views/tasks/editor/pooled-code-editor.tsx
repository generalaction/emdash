import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { rpc } from '@renderer/core/ipc';
import type { ManagedFile } from '@renderer/hooks/useFileManager';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';
import { getMonacoLanguageId } from '@renderer/lib/diffUtils';
import { codeEditorPool, type CodePoolEntry } from '@renderer/lib/monaco-code-pool';
import { configureMonacoEditor } from '@renderer/lib/monaco-config';
import { modelRegistry } from '@renderer/lib/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';

const BUFFER_DEBOUNCE_MS = 2000;

export interface PooledCodeEditorProps {
  activeFile: ManagedFile | null;
  modelRootPath: string;
  projectId: string;
  taskId: string;
  readOnly?: boolean;
  glyphMargin?: boolean;
  /** Called when content changes — use to mark the file dirty in parent state. */
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
 * and returns it on unmount. Models are managed by MonacoModelRegistry so unsaved
 * edits and undo history survive tab switches and editor releases.
 */
export function PooledCodeEditor({
  activeFile,
  modelRootPath,
  projectId,
  taskId,
  readOnly = false,
  glyphMargin = false,
  onEditorChange,
  onMount,
}: PooledCodeEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<CodePoolEntry | null>(null);
  const cancelledRef = useRef(false);
  const currentUriRef = useRef<string | null>(null);
  const bufferTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const taskIdRef = useRef(taskId);
  taskIdRef.current = taskId;

  // Apply global theme whenever it changes.
  useEffect(() => {
    codeEditorPool.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Mount: lease an editor, reparent its container, attach the registry model.
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

      // Apply per-lease options before attaching a model.
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

      // Attach the registry model for the current active file.
      const file = activeFileRef.current;
      if (file) {
        const language = getMonacoLanguageId(file.path);
        const uri = buildMonacoModelPath(modelRootPathRef.current, file.path);
        // openFile is a no-op if the model already exists (called by EditorProvider.loadFile).
        modelRegistry.openFile(
          projectIdRef.current,
          taskIdRef.current,
          modelRootPathRef.current,
          file.path,
          file.content,
          language
        );
        modelRegistry.attach(editor, uri);
        currentUriRef.current = uri;
      }

      editor.layout();

      // Subscribe to content changes — fires on every keystroke.
      const changeDisposable = editor.onDidChangeModelContent(() => {
        const model = editor.getModel();
        if (!model) return;
        // Ignore programmatic reloads from disk — they are not user edits.
        const uri = currentUriRef.current;
        if (uri && modelRegistry.isReloadingFromDisk(uri)) return;
        const value = model.getValue();
        onEditorChangeRef.current?.(value);

        // Debounced buffer save to persist unsaved edits across app restarts.
        if (bufferTimerRef.current) clearTimeout(bufferTimerRef.current);
        const filePath = activeFileRef.current?.path;
        if (filePath) {
          bufferTimerRef.current = setTimeout(() => {
            bufferTimerRef.current = null;
            const uri = currentUriRef.current;
            // Skip if the file was saved to disk since the timer was scheduled
            // (avoids re-inserting a buffer row that clearBuffer already removed).
            if (!uri || !modelRegistry.isDirty(uri)) return;
            void rpc.editorBuffer.saveBuffer(
              projectIdRef.current,
              taskIdRef.current,
              filePath,
              value
            );
          }, BUFFER_DEBOUNCE_MS);
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
      if (bufferTimerRef.current) {
        clearTimeout(bufferTimerRef.current);
        bufferTimerRef.current = null;
      }
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

  // Sync active file changes: switch the registry model, preserving view state.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease || !activeFile) return;

    const language = getMonacoLanguageId(activeFile.path);
    const newUri = buildMonacoModelPath(modelRootPath, activeFile.path);
    const previousUri = currentUriRef.current ?? undefined;

    // Ensure the model exists in the registry before attaching.
    modelRegistry.openFile(
      projectId,
      taskId,
      modelRootPath,
      activeFile.path,
      activeFile.content,
      language
    );
    modelRegistry.attach(lease.editor, newUri, previousUri);
    currentUriRef.current = newUri;
    lease.editor.layout();
  }, [activeFile?.path, modelRootPath, projectId, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} className="h-full w-full" />;
}
