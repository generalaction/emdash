import type * as monaco from 'monaco-editor';
import { DEFAULT_EDITOR_OPTIONS } from '@renderer/constants/file-explorer';
import { configureMonacoTypeScript } from '@renderer/lib/monaco-config';
import { defineMonacoThemes, getMonacoTheme } from '@renderer/lib/monaco-themes';
import { MonacoPool, type PoolEntry as GenericPoolEntry } from './monaco-pool';

export type CodePoolEntry = GenericPoolEntry<monaco.editor.IStandaloneCodeEditor>;

const codePool = new MonacoPool<monaco.editor.IStandaloneCodeEditor>({
  poolId: 'monaco-code-pool',
  reserveTarget: 1,
  createEditor: (m, container) => m.editor.create(container, { ...DEFAULT_EDITOR_OPTIONS }),
  cleanupOnRelease: (editor) => {
    // Reset per-lease options and detach model before returning to the pool.
    // Model lifecycle is owned by MonacoModelRegistry — not disposed here.
    editor.updateOptions({ readOnly: false, glyphMargin: false });
    editor.setModel(null);
  },
  onInit: async (m) => {
    // Cast required: monaco-editor types vs @monaco-editor/react Monaco type differ slightly.
    defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
    configureMonacoTypeScript(m);
  },
});

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

  /** Returns the underlying Monaco instance, or null if not yet initialised. */
  getMonaco(): typeof monaco | null {
    return codePool.getMonaco();
  },
};
