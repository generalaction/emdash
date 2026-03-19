import { useEffect, useRef } from 'react';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/core/monaco/monaco-diff-pool';
import { useBufferExists } from '@renderer/core/monaco/use-model';
import { useTheme } from '@renderer/hooks/useTheme';

export interface PooledDiffEditorProps {
  /** git:// URI for the left (original) side — e.g. git://task:abc/HEAD/src/index.ts */
  originalUri: string;
  /**
   * file:// buffer URI for the right (modified) side.
   * The pool resolves this to the buffer model (live user edits) if it exists,
   * or falls back to the disk:// model (on-disk snapshot).
   */
  modifiedUri: string;
  language: string;
  diffStyle: 'unified' | 'split';
  /** Called whenever the modified editor's content height changes — for dynamic virtualization. */
  onHeightChange?: (height: number) => void;
}

/**
 * Leases a Monaco diff editor instance from the global pool on mount and returns
 * it on unmount. Both models must already be registered in MonacoModelRegistry
 * (use `useModelStatus` to gate rendering until they're ready).
 *
 * Automatically swaps the modified side from disk to buffer (and back) when the
 * user opens or closes the file in the code editor.
 */
export function PooledDiffEditor({
  originalUri,
  modifiedUri,
  language,
  diffStyle,
  onHeightChange,
}: PooledDiffEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<DiffPoolEntry | null>(null);
  const cancelledRef = useRef(false);
  const { effectiveTheme } = useTheme();

  // Stable refs so effect closures always read current prop values.
  const diffStyleRef = useRef(diffStyle);
  diffStyleRef.current = diffStyle;
  const originalUriRef = useRef(originalUri);
  originalUriRef.current = originalUri;
  const modifiedUriRef = useRef(modifiedUri);
  modifiedUriRef.current = modifiedUri;
  const languageRef = useRef(language);
  languageRef.current = language;
  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;

  // Track whether the buffer model exists for the modified URI.
  // When a file is opened/closed in the code editor while this diff is visible,
  // re-apply content so the editor swaps between buffer and disk models.
  const bufferExists = useBufferExists(modifiedUri);

  // Apply global theme whenever it changes.
  useEffect(() => {
    diffEditorPool.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Mount: lease an editor, reparent its container, wire up models and listeners.
  useEffect(() => {
    if (!mountRef.current) return;
    const mount = mountRef.current;
    cancelledRef.current = false;

    diffEditorPool.lease().then((lease) => {
      // Component may have unmounted while the lease was async.
      if (cancelledRef.current) {
        diffEditorPool.release(lease);
        return;
      }

      leaseRef.current = lease;

      // Reparent the editor container into our mount div.
      mount.appendChild(lease.container);

      // Apply current diffStyle before setting content so the first render is correct.
      lease.editor.updateOptions({
        renderSideBySide: diffStyleRef.current === 'split',
      });

      // Set models (guaranteed ready by parent gating on useModelStatus).
      diffEditorPool.applyContent(
        lease,
        originalUriRef.current,
        modifiedUriRef.current,
        languageRef.current
      );

      // Trigger layout now that the container has real dimensions.
      lease.editor.layout();

      // Wire up height reporting for dynamic virtualization.
      const modifiedEditor = lease.editor.getModifiedEditor();
      onHeightChangeRef.current?.(modifiedEditor.getContentHeight());

      const heightDisposable = modifiedEditor.onDidContentSizeChange(
        (e: { contentHeightChanged: boolean; contentHeight: number }) => {
          if (e.contentHeightChanged) {
            onHeightChangeRef.current?.(e.contentHeight);
          }
        }
      );
      lease.disposables.push(heightDisposable);
    });

    return () => {
      cancelledRef.current = true;
      const lease = leaseRef.current;
      leaseRef.current = null;
      if (lease) {
        diffEditorPool.release(lease);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync diffStyle changes to the leased editor.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    lease.editor.updateOptions({ renderSideBySide: diffStyle === 'split' });
    lease.editor.layout();
  }, [diffStyle]);

  // Re-apply when the buffer model appears or disappears (file opened/closed in editor).
  // bufferExists changes → swap modified side between buffer (live edits) and disk snapshot.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    diffEditorPool.applyContent(
      lease,
      originalUriRef.current,
      modifiedUriRef.current,
      languageRef.current
    );
    lease.editor.layout();
  }, [bufferExists]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={mountRef} className="h-full" />;
}
