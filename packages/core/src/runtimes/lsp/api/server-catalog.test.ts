import { describe, expect, it } from 'vitest';
import { languageServers, selectLanguageServer } from './server-catalog';

describe('language server selection', () => {
  it.each(['a.ts', 'a.mts', 'a.cts', 'a.TSX', 'a.js', 'a.mjs', 'a.cjs', 'a.jsx'])(
    'selects a server and protocol language for %s',
    (name) => {
      const selected = selectLanguageServer(name);
      expect(selected?.server.id).toBe('typescript');
      expect(selected?.language.languageId).toMatch(/^(typescript|javascript)(react)?$/);
    }
  );
  it('does not activate servers for unsupported files', () => {
    expect(selectLanguageServer('a.py')).toBeUndefined();
    expect(selectLanguageServer('package.json')).toBeUndefined();
  });
  it('selects additional definitions without changing editor logic', () => {
    const custom = {
      id: 'example',
      name: 'Example',
      languages: [{ languageId: 'example', monacoLanguageId: 'plaintext', extensions: ['ex'] }],
    };
    expect(selectLanguageServer('a.ex', [...languageServers, custom])).toEqual({
      server: custom,
      language: custom.languages[0],
    });
  });
});
