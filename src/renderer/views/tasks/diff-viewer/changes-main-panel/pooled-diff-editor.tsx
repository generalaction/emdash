import { useEffect, useRef } from 'react';
import { diffEditorPool, type DiffPoolEntry } from '@renderer/core/monaco/monaco-diff-pool';
import { useTheme } from '@renderer/hooks/useTheme';

export interface PooledDiffEditorProps {
  original: string;
  modified: string;
  language: string;
  diffStyle: 'unified' | 'split';
  /**
   * Buffer URI of the file if it is currently open in the code editor.
   * When provided, the diff editor uses live registry models:
   *   original side ← gitBaseModel (base:// scheme, git HEAD snapshot)
   *   modified side ← diskModel    (disk:// scheme, current on-disk content)
   */
  registryUri?: string;
  /** Called whenever the modified editor's content height changes — for dynamic virtualization. */
  onHeightChange?: (height: number) => void;
}

/**
 * Leases a Monaco diff editor instance from the global pool on mount and returns
 * it on unmount. The pool keeps a reserve of pre-created editors so there is no
 * loader.init() or createDiffEditor() latency on first render.
 */
export function PooledDiffEditor({
  original,
  modified,
  language,
  diffStyle,
  registryUri,
  onHeightChange,
}: PooledDiffEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const leaseRef = useRef<DiffPoolEntry | null>(null);
  const cancelledRef = useRef(false);
  const { effectiveTheme } = useTheme();

  // Stable refs so effect closures always read current prop values.
  const diffStyleRef = useRef(diffStyle);
  diffStyleRef.current = diffStyle;
  const originalRef = useRef(original);
  originalRef.current = original;
  const modifiedRef = useRef(modified);
  modifiedRef.current = modified;
  const languageRef = useRef(language);
  languageRef.current = language;
  const registryUriRef = useRef(registryUri);
  registryUriRef.current = registryUri;
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

      // Set initial content (use live registry models when file is open).
      diffEditorPool.applyContent(
        lease,
        originalRef.current,
        modifiedRef.current,
        languageRef.current,
        registryUriRef.current
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

  // Re-apply content when registryUri transitions from undefined → defined.
  // This swaps inmemory models (created at mount from string fallbacks) for live
  // registry models (gitBaseModel + diskModel) once registration completes.
  // Also fires when registryUri goes back to undefined (e.g. active file cleared).
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    diffEditorPool.applyContent(
      lease,
      originalRef.current,
      modifiedRef.current,
      languageRef.current,
      registryUriRef.current
    );
    lease.editor.layout();
  }, [registryUri]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync string content changes to pool-created inmemory models.
  // Registry-owned models (base://, disk://) are kept live by the registry itself
  // and do not need to be updated here.
  useEffect(() => {
    const lease = leaseRef.current;
    if (!lease) return;
    const model = lease.editor.getModel();
    if (!model) return;
    if (model.original.uri.scheme === 'inmemory' && model.original.getValue() !== original) {
      model.original.setValue(original);
    }
    if (model.modified.uri.scheme === 'inmemory' && model.modified.getValue() !== modified) {
      model.modified.setValue(modified);
    }
  }, [original, modified]);

  return <div ref={mountRef} className="h-full" />;
}
