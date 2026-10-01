/** Portable selection metadata. Executables, roots and configuration belong to the host. */
export interface LanguageServerDefinition {
  readonly id: string;
  readonly name: string;
  readonly languages: readonly {
    readonly languageId: string;
    readonly extensions: readonly string[];
    readonly filenames?: readonly string[];
  }[];
}

export const languageServers: readonly LanguageServerDefinition[] = [
  {
    id: 'typescript',
    name: 'TypeScript / JavaScript',
    languages: [
      {
        languageId: 'typescript',
        extensions: ['ts', 'mts', 'cts'],
      },
      { languageId: 'typescriptreact', extensions: ['tsx'] },
      {
        languageId: 'javascript',
        extensions: ['js', 'mjs', 'cjs'],
      },
      { languageId: 'javascriptreact', extensions: ['jsx'] },
    ],
  },
  {
    id: 'bash',
    name: 'Bash',
    languages: [
      {
        languageId: 'shellscript',
        extensions: ['sh', 'bash'],
        filenames: [
          '.bashrc',
          '.bash_profile',
          '.bash_login',
          '.bash_logout',
          '.bash_aliases',
          '.profile',
        ],
      },
    ],
  },
  { id: 'go', name: 'Go', languages: [{ languageId: 'go', extensions: ['go'] }] },
  { id: 'rust', name: 'Rust', languages: [{ languageId: 'rust', extensions: ['rs'] }] },
  {
    id: 'python',
    name: 'Python',
    languages: [{ languageId: 'python', extensions: ['py', 'pyi', 'pyw'] }],
  },
  {
    id: 'cpp',
    name: 'C / C++',
    languages: [
      { languageId: 'c', extensions: ['c', 'h'] },
      { languageId: 'cpp', extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'] },
    ],
  },
  {
    id: 'json',
    name: 'JSON',
    languages: [
      { languageId: 'json', extensions: ['json'] },
      { languageId: 'jsonc', extensions: ['jsonc'], filenames: ['tsconfig.json', 'jsconfig.json'] },
    ],
  },
  { id: 'yaml', name: 'YAML', languages: [{ languageId: 'yaml', extensions: ['yaml', 'yml'] }] },
  { id: 'html', name: 'HTML', languages: [{ languageId: 'html', extensions: ['html', 'htm'] }] },
  {
    id: 'css',
    name: 'CSS / SCSS / Less',
    languages: [
      { languageId: 'css', extensions: ['css'] },
      { languageId: 'scss', extensions: ['scss'] },
      { languageId: 'less', extensions: ['less'] },
    ],
  },
];

export function selectLanguageServer(filename: string, servers = languageServers) {
  // A remote host may use different path separators than this renderer.
  const basename = filename.split(/[\\/]/).at(-1) ?? '';
  const extension = basename.includes('.') ? basename.split('.').at(-1)?.toLowerCase() : undefined;
  const candidates = servers.flatMap((server) =>
    server.languages.map((language) => ({ server, language }))
  );
  return (
    candidates.find(({ language }) => language.filenames?.includes(basename)) ??
    candidates.find(({ language }) => extension && language.extensions.includes(extension))
  );
}
