import type { IExecutionContext } from '@primitives/exec/api';
import type { HostDependencyDefinition } from '@primitives/host-dependencies/api';
import { createMemoryKeyValueStore } from '@primitives/kv/api';
import { describe, expect, it, vi } from 'vitest';
import { HostDependenciesRuntime } from './component';

const definition: HostDependencyDefinition = {
  id: 'fake-agent',
  name: 'Fake Agent',
  category: 'agent',
  binaryNames: ['fake-agent'],
  installCommands: {
    macos: [
      {
        method: 'npm',
        command: 'npm install -g fake-agent',
        recommended: true,
      },
    ],
    linux: [
      {
        method: 'npm',
        command: 'npm install -g fake-agent',
        recommended: true,
      },
    ],
  },
  status: 'active',
};

const elevatedDefinition: HostDependencyDefinition = {
  id: 'git',
  name: 'Git',
  category: 'core',
  binaryNames: ['git'],
  installCommands: {
    linux: [
      {
        method: 'apt',
        command: 'sudo apt-get update && sudo apt-get install -y git',
        recommended: true,
        requiresElevation: true,
      },
    ],
    macos: [
      {
        method: 'apt',
        command: 'sudo apt-get update && sudo apt-get install -y git',
        recommended: true,
        requiresElevation: true,
      },
    ],
  },
  status: 'active',
};

describe('HostDependenciesRuntime.runInstallCommand', () => {
  it('runs the selected install command and returns the refreshed view', async () => {
    const { exec } = createFakeExec({ installedAfterStreaming: true });
    const runtime = createRuntime(exec);
    const progress = vi.fn();

    const result = await runtime.runInstallCommand('fake-agent', 'npm', {
      signal: new AbortController().signal,
      progress,
    });

    expect(result.success).toBe(true);
    expect(result.success && result.data.status).toBe('available');
    expect(result.success && result.data.installOptions[0]?.command).toBe(
      'npm install -g fake-agent'
    );
    expect(exec.execStreaming).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'npm install -g fake-agent'],
      expect.any(Function),
      { signal: expect.any(AbortSignal) }
    );
    expect(exec.refreshShellEnv).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith({ phase: 'resolving' });
    expect(progress).toHaveBeenCalledWith({ phase: 'running' });
    expect(progress).toHaveBeenCalledWith({ phase: 'refreshing' });
  });

  it('returns command-failed when the install command fails', async () => {
    const { exec } = createFakeExec({ failStreaming: true });
    const runtime = createRuntime(exec);

    const result = await runtime.runInstallCommand('fake-agent', 'npm', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'command-failed',
        message: 'installer failed',
        output: 'install output',
        exitCode: null,
      },
    });
  });

  it('returns command-failed when the install command exits non-zero', async () => {
    const { exec } = createFakeExec({ exitCode: 127 });
    const runtime = createRuntime(exec);

    const result = await runtime.runInstallCommand('fake-agent', 'npm', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'command-failed',
        message: 'Install command exited with code 127',
        output: 'install output',
        exitCode: 127,
      },
    });
  });

  it('returns installer-missing when the installer tool cannot be resolved', async () => {
    const { exec } = createFakeExec({ installerMissing: true });
    const runtime = createRuntime(exec);

    const result = await runtime.runInstallCommand('fake-agent', 'npm', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'installer-missing', id: 'fake-agent', tool: 'npm', method: 'npm' },
    });
    expect(exec.execStreaming).not.toHaveBeenCalled();
  });

  it('returns not-detected-after-install when the agent is still missing', async () => {
    const { exec } = createFakeExec({ installedAfterStreaming: false });
    const runtime = createRuntime(exec);

    const result = await runtime.runInstallCommand('fake-agent', 'npm', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: { type: 'not-detected-after-install', id: 'fake-agent', output: 'install output' },
    });
  });

  it('returns permission-denied when elevation is required and the host cannot elevate', async () => {
    const { exec } = createFakeExec({ canElevate: false });
    const runtime = createRuntime(exec, [elevatedDefinition]);

    const result = await runtime.runInstallCommand('git', 'apt', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result).toEqual({
      success: false,
      error: {
        type: 'permission-denied',
        id: 'git',
        message: 'Installing git requires administrator privileges on this host.',
      },
    });
    expect(exec.execStreaming).not.toHaveBeenCalled();
  });

  it('runs elevated installs when the host can elevate', async () => {
    const { exec } = createFakeExec({
      canElevate: true,
      installedAfterStreaming: true,
      binaryName: 'git',
    });
    const runtime = createRuntime(exec, [elevatedDefinition]);

    const result = await runtime.runInstallCommand('git', 'apt', {
      signal: new AbortController().signal,
      progress: vi.fn(),
    });

    expect(result.success).toBe(true);
    expect(exec.execStreaming).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'sudo apt-get update && sudo apt-get install -y git'],
      expect.any(Function),
      { signal: expect.any(AbortSignal) }
    );
  });
});

describe('HostDependenciesRuntime.refresh', () => {
  it('includes canElevate on a full refresh snapshot', async () => {
    const { exec } = createFakeExec({ canElevate: true });
    const runtime = createRuntime(exec);

    const result = await runtime.refresh();

    expect(result.success).toBe(true);
    expect(result.success && result.data.canElevate).toBe(true);
  });

  it('reports canElevate false when sudo is unavailable', async () => {
    const { exec } = createFakeExec({ canElevate: false });
    const runtime = createRuntime(exec);

    const result = await runtime.refresh();

    expect(result.success).toBe(true);
    expect(result.success && result.data.canElevate).toBe(false);
  });
});

function createRuntime(
  exec: IExecutionContext,
  definitions: HostDependencyDefinition[] = [definition]
): HostDependenciesRuntime {
  return new HostDependenciesRuntime({
    hostId: 'test-host',
    definitions,
    store: createMemoryKeyValueStore(),
    exec,
  });
}

function createFakeExec(options: {
  installedAfterStreaming?: boolean;
  failStreaming?: boolean;
  exitCode?: number;
  installerMissing?: boolean;
  canElevate?: boolean;
  binaryName?: string;
}): {
  exec: IExecutionContext;
} {
  let installed = false;
  const binaryName = options.binaryName ?? 'fake-agent';
  const exec: IExecutionContext = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(async (command, args = []) => {
      if (command === 'id' && args[0] === '-u') {
        return { stdout: options.canElevate === true ? '0\n' : '1000\n', stderr: '' };
      }
      if (command === 'which' && args[0] === 'sudo') {
        if (options.canElevate === false) throw new Error('not found');
        return { stdout: '/usr/bin/sudo\n', stderr: '' };
      }
      if (
        (command === '/usr/bin/sudo' || command === 'sudo') &&
        args[0] === '-n' &&
        args[1] === 'true'
      ) {
        if (options.canElevate === false) throw new Error('sudo: a password is required');
        return { stdout: '', stderr: '' };
      }
      if (command === 'which' && args[0] === 'npm') {
        if (options.installerMissing) throw new Error('not found');
        return { stdout: '/usr/bin/npm\n', stderr: '' };
      }
      if (command === 'which' && args[0] === 'apt-get') {
        return { stdout: '/usr/bin/apt-get\n', stderr: '' };
      }
      if (command === 'which' && args[0] === '-a' && args[1] === binaryName) {
        if (!installed) throw new Error('not found');
        return { stdout: `/usr/local/bin/${binaryName}\n`, stderr: '' };
      }
      if (command === 'realpath' && args[0] === `/usr/local/bin/${binaryName}`) {
        return { stdout: `/usr/local/bin/${binaryName}\n`, stderr: '' };
      }
      throw new Error(`Unexpected exec: ${command} ${args.join(' ')}`);
    }),
    execStreaming: vi.fn(async (_command, _args, onChunk) => {
      onChunk('install output');
      if (options.failStreaming) throw new Error('installer failed');
      const exitCode = options.exitCode ?? 0;
      if (exitCode === 0) installed = !!options.installedAfterStreaming;
      return { exitCode };
    }),
    refreshShellEnv: vi.fn(async () => {}),
    dispose: vi.fn(),
  };
  return { exec };
}
