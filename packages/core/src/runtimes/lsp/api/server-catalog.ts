/** Portable selection metadata. Executables, roots and configuration belong to the host. */
export interface LanguageServerDefinition {
  readonly id: string;
  readonly name: string;
  readonly languages: readonly {
    readonly languageId: string;
    readonly extensions: readonly string[];
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
];

export function selectLanguageServer(filename: string, servers = languageServers) {
  const extension = filename.split('.').at(-1)?.toLowerCase();
  if (!extension) return undefined;
  for (const server of servers) {
    const language = server.languages.find((item) => item.extensions.includes(extension));
    if (language) return { server, language };
  }
  return undefined;
}
