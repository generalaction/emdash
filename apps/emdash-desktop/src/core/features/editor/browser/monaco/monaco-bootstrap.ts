import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { modelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import { configureMonacoTypeScript } from './monaco-config';
import { defineMonacoThemes, getMonacoTheme } from './monaco-themes';

let instance: typeof monaco | null = null;
let initPromise: Promise<typeof monaco> | null = null;

function configureMonacoEnvironment(): void {
  self.MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case 'json':
          return new jsonWorker();
        case 'css':
        case 'scss':
        case 'less':
          return new cssWorker();
        case 'html':
        case 'handlebars':
        case 'razor':
          return new htmlWorker();
        case 'typescript':
        case 'javascript':
          return new tsWorker();
        default:
          return new editorWorker();
      }
    },
  };
  // Serve Monaco from the bundled package instead of the default CDN so the
  // editor works offline; loader.init() resolves with this instance.
  loader.config({ monaco });
}

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
    configureMonacoEnvironment();
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
