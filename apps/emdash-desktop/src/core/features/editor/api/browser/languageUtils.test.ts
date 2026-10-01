import { describe, expect, it } from 'vitest';
import { getLanguageFromPath } from './languageUtils';

describe('language IDs for LSP-capable models', () => {
  it.each(['ts', 'tsx', 'mts', 'cts', 'MTS'])(
    'uses the TypeScript providers for .%s files',
    (extension) => {
      expect(getLanguageFromPath(`/workspace/module.${extension}`)).toBe('typescript');
    }
  );
  it.each(['js', 'jsx', 'mjs', 'cjs', 'CJS'])(
    'uses the JavaScript providers for .%s files',
    (extension) => {
      expect(getLanguageFromPath(`/workspace/module.${extension}`)).toBe('javascript');
    }
  );
});
