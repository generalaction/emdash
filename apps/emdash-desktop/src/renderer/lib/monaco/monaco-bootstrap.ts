import { loader } from '@monaco-editor/react';
import type * as monaco from 'monaco-editor';
import { configureMonacoTypeScript } from './monaco-config';
import { modelRegistry } from './monaco-model-registry';
import { defineMonacoThemes, getMonacoTheme } from './monaco-themes';

let instance: typeof monaco | null = null;
let initPromise: Promise<typeof monaco> | null = null;

/**
 * Shared Monaco bootstrap — the single entry point for loading Monaco,
 * defining themes, and configuring TypeScript support.
 *
 * Both EditorProvider (code editor) and StickyDiffEditor (diff editor) use this
 * instead of maintaining separate pools. Bootstrap is idempotent: subsequent
 * calls to init() return the same promise. The resolved instance is exposed via
 * globalThis.__monaco so module-level code (e.g. monaco-comment-manager) can
 * access it without importing the bootstrap directly.
 */
export const monacoBootstrap = {
  /** Load Monaco once, set up themes and TypeScript. Safe to call multiple times. */
  init(): Promise<typeof monaco> {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const m = await loader.init();
      instance = m;
      // oxlint-disable-next-line typescript/no-explicit-any
      (globalThis as any).__monaco = m;
      modelRegistry.notifyMonacoReady(m);
      defineMonacoThemes(m as Parameters<typeof defineMonacoThemes>[0]);
      configureMonacoTypeScript(m);
      return m;
    })();
    return initPromise;
  },

  /** Returns the loaded Monaco namespace, or null if init() has not yet resolved. */
  getMonaco(): typeof monaco | null {
    return instance;
  },

  /** Update the active Monaco theme across all editor instances simultaneously. */
  setTheme(effectiveTheme: string): void {
    if (!instance) return;
    defineMonacoThemes(instance as Parameters<typeof defineMonacoThemes>[0]);
    instance.editor.setTheme(getMonacoTheme(effectiveTheme));
  },
};
