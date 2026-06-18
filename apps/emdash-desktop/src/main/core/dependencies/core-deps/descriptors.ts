import type { DependencyDescriptor } from '@emdash/core/deps/runtime';

const BOO_INSTALL = {
  method: 'curl' as const,
  command: 'curl -fsSL https://raw.githubusercontent.com/coder/boo/main/install.sh | sh',
  label: 'Official installer',
  recommended: true,
};

const boo: DependencyDescriptor = {
  id: 'boo',
  name: 'boo',
  category: 'core',
  commands: ['boo'],
  versionArgs: ['--version'],
  docUrl: 'https://github.com/coder/boo',
  // boo ships macOS + Linux installers only (no Windows).
  installCommands: { macos: [BOO_INSTALL], linux: [BOO_INSTALL] },
};

const tmux: DependencyDescriptor = {
  id: 'tmux',
  name: 'tmux',
  category: 'core',
  commands: ['tmux'],
  versionArgs: ['-V'],
  // Detection-only (spec §14 Q4): no installCommands.
};

export const CORE_DEPENDENCIES: DependencyDescriptor[] = [boo, tmux];
