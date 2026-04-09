import { useEffect, useRef } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/lib/monaco/monaco-diff-pool';

export interface PooledDiffEditorProps {
  /** URI for the left (original/before) side — typically git:// */
  originalUri: string;
  /** URI for the right (modified/after) side — disk://, git://, etc. */
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

  return <div ref={mountRef} className="h-full" />;
}
