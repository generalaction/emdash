import type * as monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/constants/file-explorer';
import { configureMonacoTypeScript } from '@renderer/lib/monaco-config';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco-themes';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { MonacoPool, type PoolEntry as GenericPoolEntry } from './monaco-pool';

export type CodePoolEntry = GenericPoolEntry<monaco.editor.IStandaloneCodeEditor>;

const codePool = new MonacoPool<monaco.editor.IStandaloneCodeEditor>({
  poolId: 'monaco-code-pool',
  reserveTarget: 1,
  createEditor: (m, container) => m.editor.create(container, { ...DEFAULT_EDITOR_OPTIONS }),
  cleanupOnRelease: (editor) => {
    // Reset per-lease options before returning to the pool.
    editor.updateOptions({ readOnly: false, glyphMargin: false });
    // Detach model but keep it alive in modelCache for the next lease.
    editor.setModel(null);
  },
  onInit: async (m) => {
    // Cast required: monaco-editor types vs @monaco-editor/react Monaco type differ slightly.
    defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    configureMonacoTypeScript(m);
  },
});

/**
 * Model cache: keyed by Monaco URI string.
 * Models persist across editor releases so unsaved edits and undo history are never lost.
 */
const modelCache = new Map<string, monaco.editor.ITextModel>();

/**
 * View state cache: keyed by Monaco URI string.
 * Saves cursor position, scroll, and folding state between file switches.
 */
const viewStateCache = new Map<string, monaco.editor.ICodeEditorViewState | null>();

export const codeEditorPool = {
  init(): Promise<void> {
    return codePool.init();
  },

  lease(): Promise<CodePoolEntry> {
    return codePool.lease();
  },

  release(entry: CodePoolEntry): void {
    codePool.release(entry);
  },

  /**
   * Update Monaco's global theme for all code editor instances.
   * Accepts the app's effectiveTheme string ('dark', 'dark-black', 'light').
   */
  setTheme(effectiveTheme: string): void {
    codePool.setTheme(getMonacoTheme(effectiveTheme));
  },

  /**
   * Attach the correct model to the leased editor for a given file.
   *
   * - Reuses a cached model if one exists for the URI — never overwrites content,
   *   preserving any unsaved edits and the undo/redo stack.
   * - Saves the view state (cursor, scroll) for `previousUri` before switching.
   * - Restores the saved view state for the new file if available.
   *
   * Returns the URI string for the new file (store in a ref for the next call).
   */
  applyFile(
    entry: CodePoolEntry,
    modelRootPath: string,
    filePath: string,
    content: string,
    language: string,
    previousUri?: string
  ): string {
    const m = codePool.getMonaco();
    const uri = buildMonacoModelPath(modelRootPath, filePath);

    if (previousUri && previousUri !== uri) {
      viewStateCache.set(previousUri, entry.editor.saveViewState());
    }

    if (m) {
      const monacoUri = m.Uri.parse(uri);
      let model = modelCache.get(uri) ?? m.editor.getModel(monacoUri);
      if (!model) {
        model = m.editor.createModel(content, language, monacoUri);
        modelCache.set(uri, model);
      }
      entry.editor.setModel(model);
    }

    const savedViewState = viewStateCache.get(uri);
    if (savedViewState) {
      entry.editor.restoreViewState(savedViewState);
    }

    return uri;
  },

  /**
   * Dispose a model and remove it from both caches.
   * Call this when the user closes a file tab.
   */
  disposeModel(uri: string): void {
    const model = modelCache.get(uri);
    if (model && !model.isDisposed()) {
      model.dispose();
    }
    modelCache.delete(uri);
    viewStateCache.delete(uri);
  },

  /** Returns the underlying Monaco instance, or null if not yet initialised. */
  getMonaco(): typeof monaco | null {
    return codePool.getMonaco();
  },
};
