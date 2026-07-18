import { autorun, observable, runInAction } from 'mobx';
import type * as monaco from 'monaco-editor';
import { useEffect, useRef } from 'react';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { monacoBootstrap } from '@renderer/lib/monaco/monaco-bootstrap';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { DIFF_EDITOR_BASE_OPTIONS } from './editorConfig';

export function revealFirstDiffChangeWhenReady(
  editor: monaco.editor.IStandaloneDiffEditor
): monaco.IDisposable | null {
  const reveal = () => {
    const firstChange = editor.getLineChanges()?.[0];
    if (!firstChange) return false;

    editor.getModifiedEditor().revealLineNearTop(Math.max(1, firstChange.modifiedStartLineNumber));
    return true;
  };

  if (reveal()) return null;

  const disposable = editor.onDidUpdateDiff(() => {
    if (!reveal()) return;
    disposable.dispose();
  });
  return disposable;
}

export interface StickyDiffEditorProps {
  /** URI for the left (original/before) side — typically git:// */
  originalUri: string;
  /** URI for the right (modified/after) side — disk://, git://, etc. */
  modifiedUri: string;
  diffStyle: 'unified' | 'split';
  /** Called whenever the content height changes, for auto-sizing parent containers. */
  onHeightChange?: (height: number) => void;
  /** Called when the diff editor instance is created/disposed. */
  onEditorChange?: (editor: monaco.editor.IStandaloneDiffEditor | null) => void;
}

export function StickyDiffEditor({
  originalUri,
  modifiedUri,
  diffStyle,
  onHeightChange,
  onEditorChange,
}: StickyDiffEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const modifiedUriRef = useRef(modifiedUri);
  modifiedUriRef.current = modifiedUri;

  // Observable box so the autorun can react to the editor arriving after async mount.
  const editorBox = useRef(
    observable.box<monaco.editor.IStandaloneDiffEditor | null>(null)
  ).current;

  const onHeightChangeRef = useRef(onHeightChange);
  onHeightChangeRef.current = onHeightChange;

  const onEditorChangeRef = useRef(onEditorChange);
  onEditorChangeRef.current = onEditorChange;

  const { effectiveTheme } = useTheme();

  // Create editor once on mount, dispose on unmount.
  // Monaco is guaranteed ready because monacoBootstrap.init() is awaited in main.tsx.
  useEffect(() => {
    const m = monacoBootstrap.getMonaco();
    if (!m || !mountRef.current) return;

    const editor = m.editor.createDiffEditor(mountRef.current, {
      ...DIFF_EDITOR_BASE_OPTIONS,
      readOnly: !modifiedUriRef.current.startsWith('file://'),
      renderSideBySide: diffStyle === 'split',
    });
    onEditorChangeRef.current?.(editor);

    const modifiedEditor = editor.getModifiedEditor();
    modifiedEditor.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.KeyS, () => {
      const uri = modifiedUriRef.current;
      if (!uri.startsWith('file://')) return;
      void modelRegistry.saveFileToDisk(uri);
    });

    const heightDisposable = modifiedEditor.onDidContentSizeChange(
      (e: { contentHeightChanged: boolean; contentHeight: number }) => {
        if (e.contentHeightChanged) {
          onHeightChangeRef.current?.(e.contentHeight);
        }
      }
    );

    runInAction(() => editorBox.set(editor));

    return () => {
      onEditorChangeRef.current?.(null);
      heightDisposable.dispose();
      runInAction(() => editorBox.set(null));
      editor.dispose();
    };
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  // Sync diffStyle changes to the mounted editor.
  useEffect(() => {
    editorBox.get()?.updateOptions({ renderSideBySide: diffStyle === 'split' });
  }, [diffStyle, editorBox]);

  useEffect(() => {
    editorBox.get()?.updateOptions({ readOnly: !modifiedUri.startsWith('file://') });
  }, [modifiedUri, editorBox]);

  // Sync global Monaco theme (affects all editor instances simultaneously).
  useEffect(() => {
    monacoBootstrap.setTheme(effectiveTheme);
  }, [effectiveTheme]);

  // Reactive content application — recreated when URIs change.
  // The autorun waits for both models to be 'ready' in the registry, then calls
  // setModel in-place without remounting the editor component.
  useEffect(() => {
    let diffUpdateDisposable: monaco.IDisposable | null = null;

    // Clear the previously-attached models synchronously on URI change so the
    // editor doesn't keep showing the previous file's content while the new
    // models are still loading.
    const current = editorBox.get();
    if (current) {
      const prev = current.getModel();
      if (prev) {
        current.setModel(null);
        if (prev.original.uri.scheme === 'inmemory') prev.original.dispose();
        if (prev.modified.uri.scheme === 'inmemory') prev.modified.dispose();
      }
    }

    const disposer = autorun(() => {
      const editor = editorBox.get(); // reactive: waits for editor to exist
      if (!editor) return;

      const origStatus = modelRegistry.modelStatus.get(originalUri); // reactive
      const modStatus = modelRegistry.modelStatus.get(modifiedUri); // reactive
      if (origStatus !== 'ready' || modStatus !== 'ready') return;

      const origModel = modelRegistry.getModelByUri(originalUri);
      const modModel = modelRegistry.getModelByUri(modifiedUri);
      if (!origModel || !modModel) return;

      const attached = editor.getModel();
      if (attached?.original === origModel && attached?.modified === modModel) return;

      // Clean up any previous inmemory models to avoid leaks (mirrors applyContent).
      if (attached) {
        editor.setModel(null);
        if (attached.original.uri.scheme === 'inmemory') attached.original.dispose();
        if (attached.modified.uri.scheme === 'inmemory') attached.modified.dispose();
      }

      editor.setModel({ original: origModel, modified: modModel });
      editor.layout();
      modelRegistry.restoreDiffViewState(originalUri, modifiedUri, editor);

      // Cached models can already have line changes before onDidUpdateDiff is
      // subscribed. Try synchronously first, then wait for async diff calculation.
      diffUpdateDisposable?.dispose();
      diffUpdateDisposable = revealFirstDiffChangeWhenReady(editor);
      onHeightChangeRef.current?.(editor.getModifiedEditor().getContentHeight());
    });

    return () => {
      // On unmount or URI change: save the current viewport so it can be restored later.
      const ed = editorBox.get();
      if (ed?.getModel()) modelRegistry.saveDiffViewState(originalUri, modifiedUri, ed);
      diffUpdateDisposable?.dispose();
      disposer();
    };
    // editorBox is a stable ref created once; only URI changes recreate the autorun.
    // oxlint-disable-next-line react/exhaustive-deps
  }, [originalUri, modifiedUri]);

  return <div ref={mountRef} className="h-full" />;
}
