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
      error: { type: 'command-failed', message: 'installer failed', output: 'install output' },
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
});

function createRuntime(exec: IExecutionContext): HostDependenciesRuntime {
  return new HostDependenciesRuntime({
    hostId: 'test-host',
    definitions: [definition],
    store: createMemoryKeyValueStore(),
    exec,
  });
}

function createFakeExec(options: {
  installedAfterStreaming?: boolean;
  failStreaming?: boolean;
  exitCode?: number;
  installerMissing?: boolean;
}): {
  exec: IExecutionContext;
} {
  let installed = false;
  const exec: IExecutionContext = {
    root: '',
    supportsLocalSpawn: true,
    exec: vi.fn(async (command, args = []) => {
      if (command === 'which' && args[0] === 'npm') {
        if (options.installerMissing) throw new Error('not found');
        return { stdout: '/usr/bin/npm\n', stderr: '' };
      }
      if (command === 'which' && args[0] === '-a' && args[1] === 'fake-agent') {
        if (!installed) throw new Error('not found');
        return { stdout: '/usr/local/bin/fake-agent\n', stderr: '' };
      }
      if (command === 'realpath' && args[0] === '/usr/local/bin/fake-agent') {
        return { stdout: '/usr/local/bin/fake-agent\n', stderr: '' };
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
