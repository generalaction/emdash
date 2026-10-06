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
    for (const name of ['README', 'a.txt', 'a.zsh', 'a.fish', '.zshrc', '/folder.py/README']) {
      expect(selectLanguageServer(name), name).toBeUndefined();
    }
  });
  it.each([
    ['scripts/build.sh', 'bash', 'shellscript'],
    ['scripts/build.bash', 'bash', 'shellscript'],
    ['/home/user/.bashrc', 'bash', 'shellscript'],
    ['C:\\Users\\me\\.bash_profile', 'bash', 'shellscript'],
    ['.bash_aliases', 'bash', 'shellscript'],
    ['main.go', 'go', 'go'],
    ['lib.rs', 'rust', 'rust'],
    ['main.py', 'python', 'python'],
    ['types.pyi', 'python', 'python'],
    ['app.pyw', 'python', 'python'],
    ['main.c', 'cpp', 'c'],
    ['api.h', 'cpp', 'c'],
    ['main.cpp', 'cpp', 'cpp'],
    ['main.cc', 'cpp', 'cpp'],
    ['main.cxx', 'cpp', 'cpp'],
    ['api.hpp', 'cpp', 'cpp'],
    ['api.hh', 'cpp', 'cpp'],
    ['api.hxx', 'cpp', 'cpp'],
    ['package.json', 'json', 'json'],
    ['tsconfig.jsonc', 'json', 'jsonc'],
    ['tsconfig.json', 'json', 'jsonc'],
    ['jsconfig.json', 'json', 'jsonc'],
    ['config.yaml', 'yaml', 'yaml'],
    ['config.YML', 'yaml', 'yaml'],
    ['index.html', 'html', 'html'],
    ['index.htm', 'html', 'html'],
    ['style.css', 'css', 'css'],
    ['style.scss', 'css', 'scss'],
    ['style.less', 'css', 'less'],
  ])('selects %s independently of the host path syntax', (filename, serverId, languageId) => {
    const selected = selectLanguageServer(filename);
    expect(selected?.server.id).toBe(serverId);
    expect(selected?.language.languageId).toBe(languageId);
  });
  it('selects additional definitions without changing editor logic', () => {
    const custom = {
      id: 'example',
      name: 'Example',
      languages: [{ languageId: 'example', extensions: ['ex'] }],
    };
    expect(selectLanguageServer('a.ex', [...languageServers, custom])).toEqual({
      server: custom,
      language: custom.languages[0],
    });
  });
});
