import type {
  HostDependencyDefinition,
  InstallCommandOption,
} from '#primitives/host-dependencies/api';
import { aptInstallCommand } from './apt-commands';

function onEveryPlatform(option: InstallCommandOption) {
  return { macos: [option], linux: [option], windows: [option] };
}

function npmServer(
  id: string,
  name: string,
  packages: string,
  installDocs: string
): HostDependencyDefinition {
  return {
    id,
    name,
    category: 'core',
    binaryNames: [id],
    installDocs,
    status: 'active',
    installCommands: onEveryPlatform({
      method: 'npm',
      command: `npm install -g ${packages}`,
      elevation: 'never',
    }),
  };
}

/** Optional host tools, discovered and selected like every other machine dependency. */
export const LANGUAGE_SERVER_DEPENDENCIES: HostDependencyDefinition[] = [
  npmServer(
    'typescript-language-server',
    'TypeScript language server',
    'typescript-language-server@6.0.1 typescript@6.0.3',
    'https://github.com/typescript-language-server/typescript-language-server'
  ),
  npmServer(
    'bash-language-server',
    'Bash language server',
    'bash-language-server@5.8.1',
    'https://github.com/bash-lsp/bash-language-server'
  ),
  npmServer(
    'pyright-langserver',
    'Python language server (Pyright)',
    'pyright@1.1.414',
    'https://github.com/microsoft/pyright'
  ),
  {
    id: 'gopls',
    name: 'Go language server (gopls)',
    category: 'core',
    binaryNames: ['gopls'],
    installDocs: 'https://go.dev/gopls/',
    status: 'active',
    installCommands: onEveryPlatform({
      method: 'other',
      command: 'go install golang.org/x/tools/gopls@v0.23.0',
      label: 'Install with Go (requires Go on PATH)',
      elevation: 'never',
    }),
  },
  {
    id: 'rust-analyzer',
    name: 'Rust language server (rust-analyzer)',
    category: 'core',
    binaryNames: ['rust-analyzer'],
    installDocs: 'https://rust-analyzer.github.io/book/installation.html',
    status: 'active',
    installCommands: onEveryPlatform({
      method: 'other',
      command: 'rustup component add rust-analyzer rust-src',
      label: 'Install with rustup (requires a Rust toolchain)',
      elevation: 'never',
    }),
  },
  {
    id: 'clangd',
    name: 'C / C++ language server (clangd)',
    category: 'core',
    binaryNames: ['clangd'],
    installDocs: 'https://clangd.llvm.org/installation',
    status: 'active',
    installCommands: {
      macos: [
        {
          method: 'homebrew',
          command: 'brew install llvm',
          elevation: 'never',
          label: 'Install LLVM (add its bin directory to PATH)',
        },
      ],
      linux: [
        {
          method: 'apt',
          command: aptInstallCommand(['clangd']),
          packages: ['clangd'],
          elevation: 'always',
        },
      ],
      windows: [{ method: 'winget', command: 'winget install --id LLVM.LLVM', elevation: 'never' }],
    },
  },
  ...['json', 'html', 'css'].map((language) =>
    npmServer(
      `vscode-${language}-language-server`,
      `${language.toUpperCase()} language server`,
      'vscode-langservers-extracted@4.10.0',
      'https://github.com/hrsh7th/vscode-langservers-extracted'
    )
  ),
  npmServer(
    'yaml-language-server',
    'YAML language server',
    'yaml-language-server@1.24.0',
    'https://github.com/redhat-developer/yaml-language-server'
  ),
];
