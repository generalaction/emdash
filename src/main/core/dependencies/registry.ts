import { listDetectableProviders } from '@shared/agent-provider-registry';
import type { DependencyStatus } from '@shared/dependencies';
import type { DependencyDescriptor, ProbeResult } from './types';

const CORE_DEPENDENCIES: DependencyDescriptor[] = [
  {
    id: 'git',
    name: 'Git',
    category: 'core',
    commands: ['git'],
    versionArgs: ['--version'],
    docUrl: 'https://git-scm.com',
    installHint: 'Install Git from https://git-scm.com/downloads',
  },
  {
    id: 'gh',
    name: 'GitHub CLI',
    category: 'core',
    commands: ['gh'],
    versionArgs: ['--version'],
    docUrl: 'https://cli.github.com',
    installHint: 'Run: brew install gh  (or see https://cli.github.com)',
    installCommand: (() => {
      switch (process.platform) {
        case 'darwin':
          return 'brew install gh';
        case 'linux':
          return 'sudo apt update && sudo apt install -y gh';
        case 'win32':
          return 'winget install GitHub.cli';
        default:
          return undefined;
      }
    })(),
  },
  {
    id: 'tmux',
    name: 'tmux',
    category: 'core',
    commands: ['tmux'],
    versionArgs: ['-V'],
    docUrl: 'https://github.com/tmux/tmux',
    installHint: 'Run: brew install tmux',
  },
  {
    id: 'ssh',
    name: 'SSH',
    category: 'core',
    commands: ['ssh'],
    versionArgs: ['-V'],
    docUrl: 'https://www.openssh.com',
  },
  {
    id: 'node',
    name: 'Node.js',
    category: 'core',
    commands: ['node'],
    versionArgs: ['--version'],
    docUrl: 'https://nodejs.org',
    installHint: 'Install Node.js from https://nodejs.org or via nvm',
  },
];

/**
 * Agents that output their version on stderr, time out during probing, or return
 * a non-zero exit code are still "available" if a path was resolved or any output
 * was produced. This mirrors the logic in ConnectionsService.resolveStatus().
 */
function agentResolveStatus(result: ProbeResult): DependencyStatus {
  if (result.path !== null) return 'available';
  if (result.timedOut && result.stdout) return 'available';
  if (result.exitCode !== null && (result.stdout || result.stderr)) return 'available';
  return result.exitCode === null ? 'missing' : 'error';
}

function buildAgentDependencies(): DependencyDescriptor[] {
  return listDetectableProviders().map((provider) => ({
    id: provider.id,
    name: provider.name,
    category: 'agent' as const,
    commands: provider.commands ?? [provider.cli ?? provider.id],
    versionArgs: provider.versionArgs ?? ['--version'],
    docUrl: provider.docUrl,
    installHint: provider.installCommand ? `Run: ${provider.installCommand}` : undefined,
    installCommand: provider.installCommand,
    resolveStatus: agentResolveStatus,
  }));
}

export const DEPENDENCIES: DependencyDescriptor[] = [
  ...CORE_DEPENDENCIES,
  ...buildAgentDependencies(),
];

export function getDependencyDescriptor(id: string): DependencyDescriptor | undefined {
  return DEPENDENCIES.find((d) => d.id === id);
}
