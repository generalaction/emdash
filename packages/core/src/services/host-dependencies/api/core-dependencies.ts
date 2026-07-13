import type { DependencyDescriptor } from '@services/host-dependencies/api/runtime/types';

export const GIT_DEPENDENCY_DESCRIPTOR: DependencyDescriptor = {
  id: 'git',
  name: 'Git',
  category: 'core',
  commands: ['git'],
  versionArgs: ['--version'],
  docUrl: 'https://git-scm.com/downloads',
  installCommands: {
    macos: [
      {
        method: 'homebrew',
        command: 'brew install git',
        updateCommand: 'brew upgrade git',
        uninstallCommand: 'brew uninstall git',
        recommended: true,
      },
    ],
    linux: [
      {
        method: 'apt',
        command: 'sudo apt-get update && sudo apt-get install -y git',
        updateCommand: 'sudo apt-get update && sudo apt-get install --only-upgrade -y git',
        uninstallCommand: 'sudo apt-get remove -y git',
        recommended: true,
      },
    ],
    windows: [
      {
        method: 'winget',
        command: 'winget install --id Git.Git -e',
        updateCommand: 'winget upgrade --id Git.Git -e',
        uninstallCommand: 'winget uninstall --id Git.Git -e',
        recommended: true,
      },
    ],
  },
  updates: { kind: 'none' },
  uninstall: { kind: 'none' },
};

export const CORE_DEPENDENCIES: DependencyDescriptor[] = [GIT_DEPENDENCY_DESCRIPTOR];
