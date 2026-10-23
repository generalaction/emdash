import { describe, expect, it } from 'vitest';
import { getLanguageFromPath } from './languageUtils';

describe('language IDs for LSP-capable models', () => {
  it.each([
    ['build.sh', 'shell'],
    ['build.bash', 'shell'],
    ['.bashrc', 'shell'],
    ['C:\\Users\\me\\.bash_profile', 'shell'],
    ['.bash_aliases', 'shell'],
    ['main.py', 'python'],
    ['types.pyi', 'python'],
    ['app.pyw', 'python'],
    ['main.go', 'go'],
    ['lib.rs', 'rust'],
    ['main.c', 'c'],
    ['api.h', 'c'],
    ['main.cpp', 'cpp'],
    ['main.cc', 'cpp'],
    ['main.cxx', 'cpp'],
    ['api.hpp', 'cpp'],
    ['api.hh', 'cpp'],
    ['api.hxx', 'cpp'],
    ['package.json', 'json'],
    ['tsconfig.jsonc', 'json'],
    ['config.yaml', 'yaml'],
    ['index.htm', 'html'],
    ['index.html', 'html'],
    ['style.css', 'css'],
    ['style.scss', 'scss'],
    ['style.less', 'less'],
  ])('uses the Monaco language for %s', (filename, language) => {
    expect(getLanguageFromPath(`/workspace/${filename}`)).toBe(language);
  });
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
