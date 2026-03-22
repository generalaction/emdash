import type * as monacoNS from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { codeEditorPool, type CodePoolEntry } from '@renderer/core/monaco/monaco-code-pool';
import { configureMonacoEditor } from '@renderer/core/monaco/monaco-config';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { getMonacoTheme } from '@renderer/core/monaco/monaco-themes';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { useTheme } from '@renderer/hooks/useTheme';
import { registerActiveCodeEditor } from '@renderer/lib/activeCodeEditor';

export interface PooledCodeEditorProps {
  /** The file:// buffer URI for the file to display. */
  bufferUri: string;
  readOnly?: boolean;
  glyphMargin?: boolean;
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
 * and returns it on unmount. Models are managed by MonacoModelRegistry — this
 * component only attaches/detaches them; registration is driven by EditorProvider.
 */
export function PooledCodeEditor({
  bufferUri,
  readOnly = false,
  glyphMargin = false,
  onMount,
}: PooledCodeEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<CodePoolEntry | null>(null);
  const cancelledRef = useRef(false);
  const currentUriRef = useRef<string | null>(null);
  const { effectiveTheme } = useTheme();

  // Subscribe to the disk model so FS watching + polling stay active while this file
  // is open — external edits propagate via applyDiskUpdate → buffer model refresh.
  const diskUri = modelRegistry.toDiskUri(bufferUri);
  useModelStatus(diskUri);

  // Stable refs so effect closures always see current prop values without re-running.
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const glyphMarginRef = useRef(glyphMargin);
  glyphMarginRef.current = glyphMargin;
  const bufferUriRef = useRef(bufferUri);
  bufferUriRef.current = bufferUri;
  const onMountRef = useRef(onMount);
  onMountRef.current = onMount;

  // Apply global theme whenever it changes.
  useEffect(() => {
    codeEditorPool.setTheme(getMonacoTheme(effectiveTheme));
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

      // Attach registry model for the current buffer URI.
      // EditorProvider awaits registerModel before updating state, so the buffer
      // model will usually exist already. onceBufferReady handles the rare race
      // during initial restore where the lease completes before registration finishes.
      const uri = bufferUriRef.current;
      currentUriRef.current = uri;
      const doAttach = () => modelRegistry.attach(editor, uri);
      const cancelReadyCallback = modelRegistry.onceBufferReady(uri, doAttach);
      lease.disposables.push({ dispose: cancelReadyCallback });

      editor.layout();

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

  // Sync bufferUri changes: switch the registry model, preserving view state.
  // Models are registered by EditorProvider before openFiles state is updated,
  // so by the time this effect fires the buffer model should already exist.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease || !bufferUri) return;

    const previousUri = currentUriRef.current ?? undefined;
    modelRegistry.attach(lease.editor, bufferUri, previousUri);
    currentUriRef.current = bufferUri;
    lease.editor.layout();
  }, [bufferUri]);

  return <div ref={mountRef} className="h-full w-full bg-(--monaco-bg)" />;
}
