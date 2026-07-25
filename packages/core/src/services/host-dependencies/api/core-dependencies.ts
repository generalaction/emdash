import type { HostDependencyDefinition } from '@primitives/host-dependencies/api';

const aptInstallCommand = (packages: string) =>
  `if command -v sudo >/dev/null 2>&1; then sudo apt-get update && sudo apt-get install -y ${packages}; else apt-get update && apt-get install -y ${packages}; fi`;

export const GIT_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'git',
  name: 'Git',
  category: 'core',
  binaryNames: ['git'],
  installDocs: 'https://git-scm.com/downloads',
  installCommands: {
    macos: [{ method: 'homebrew', command: 'brew install git', recommended: true }],
    linux: [{ method: 'apt', command: aptInstallCommand('git'), recommended: true }],
    windows: [{ method: 'winget', command: 'winget install --id Git.Git', recommended: true }],
  },
  status: 'active',
};

export const RIPGREP_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'ripgrep',
  name: 'Ripgrep',
  category: 'core',
  binaryNames: ['rg'],
  installDocs: 'https://github.com/BurntSushi/ripgrep#installation',
  installCommands: {
    macos: [{ method: 'homebrew', command: 'brew install ripgrep', recommended: true }],
    linux: [{ method: 'apt', command: aptInstallCommand('ripgrep'), recommended: true }],
    windows: [
      {
        method: 'winget',
        command: 'winget install --id BurntSushi.ripgrep.MSVC',
        recommended: true,
      },
    ],
  },
  status: 'active',
};

export const NODE_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'node',
  name: 'Node.js',
  category: 'core',
  binaryNames: ['node'],
  installDocs: 'https://nodejs.org/en/download',
  installCommands: {
    macos: [{ method: 'homebrew', command: 'brew install node', recommended: true }],
    linux: [{ method: 'apt', command: aptInstallCommand('nodejs npm'), recommended: true }],
    windows: [
      { method: 'winget', command: 'winget install --id OpenJS.NodeJS.LTS', recommended: true },
    ],
  },
  status: 'active',
};

export const NPM_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'npm',
  name: 'npm',
  category: 'core',
  binaryNames: ['npm'],
  installDocs: 'https://docs.npmjs.com/downloading-and-installing-node-js-and-npm',
  installCommands: {
    macos: [{ method: 'homebrew', command: 'brew install node', recommended: true }],
    linux: [{ method: 'apt', command: aptInstallCommand('npm'), recommended: true }],
    windows: [
      { method: 'winget', command: 'winget install --id OpenJS.NodeJS.LTS', recommended: true },
    ],
  },
  status: 'active',
};

export const TMUX_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'tmux',
  name: 'tmux',
  category: 'core',
  binaryNames: ['tmux'],
  installDocs: 'https://github.com/tmux/tmux/wiki/Installing',
  installCommands: {
    macos: [{ method: 'homebrew', command: 'brew install tmux', recommended: true }],
    linux: [{ method: 'apt', command: aptInstallCommand('tmux'), recommended: true }],
  },
  status: 'active',
};

export const CURL_DEPENDENCY_DESCRIPTOR: HostDependencyDefinition = {
  id: 'curl',
  name: 'curl',
  category: 'core',
  binaryNames: ['curl'],
  installDocs: 'https://curl.se/download.html',
  installCommands: {
    linux: [{ method: 'apt', command: aptInstallCommand('curl'), recommended: true }],
    windows: [{ method: 'winget', command: 'winget install --id cURL.cURL', recommended: true }],
  },
  status: 'active',
};

export const REQUIRED_CORE_DEPENDENCIES: HostDependencyDefinition[] = [
  GIT_DEPENDENCY_DESCRIPTOR,
  RIPGREP_DEPENDENCY_DESCRIPTOR,
];

export const RECOMMENDED_CORE_DEPENDENCIES: HostDependencyDefinition[] = [
  NODE_DEPENDENCY_DESCRIPTOR,
  NPM_DEPENDENCY_DESCRIPTOR,
  TMUX_DEPENDENCY_DESCRIPTOR,
  CURL_DEPENDENCY_DESCRIPTOR,
];

export const CORE_DEPENDENCIES: HostDependencyDefinition[] = [
  ...REQUIRED_CORE_DEPENDENCIES,
  ...RECOMMENDED_CORE_DEPENDENCIES,
];
