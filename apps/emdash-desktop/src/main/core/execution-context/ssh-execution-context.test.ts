import { EventEmitter } from 'node:events';
import type { Client, ClientCallback, ClientChannel } from 'ssh2';
import { describe, expect, it, vi } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import { SshClientProxy } from '@main/core/ssh/lifecycle/ssh-client-proxy';
import { buildSshCommand, SshExecutionContext } from './ssh-execution-context';

describe('buildSshCommand', () => {
  it('uses the shared remote shell command builder for fallback SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'which', ['claude']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });

  it('uses the remote shell profile and cwd when building SSH exec commands', () => {
    const profile: RemoteShellProfile = {
      shell: '/bin/zsh',
      env: {
        PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
      },
    };

    const command = buildSshCommand('/workspace/project', 'which', ['claude'], profile);

    expect(command).toBe(
      "'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd '\\''/workspace/project'\\'' && which '\\''claude'\\'''"
    );
  });

  it('disables interactive Git credential prompts for SSH exec commands', () => {
    const command = buildSshCommand('/workspace/project', 'git', ['fetch', 'origin']);

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && GIT_ASKPASS='\\'''\\'' GIT_TERMINAL_PROMPT='\\''0'\\'' GCM_INTERACTIVE='\\''never'\\'' SSH_ASKPASS='\\'''\\'' '\\''git'\\'' '\\''fetch'\\'' '\\''origin'\\'''"
    );
  });

  it('uses the selected remote Git executable when provided', () => {
    const command = buildSshCommand(
      '/workspace/project',
      'git',
      ['status'],
      undefined,
      '/opt/homebrew/bin/git'
    );

    expect(command).toBe(
      "'/bin/sh' -c 'cd '\\''/workspace/project'\\'' && GIT_ASKPASS='\\'''\\'' GIT_TERMINAL_PROMPT='\\''0'\\'' GCM_INTERACTIVE='\\''never'\\'' SSH_ASKPASS='\\'''\\'' '\\''/opt/homebrew/bin/git'\\'' '\\''status'\\'''"
    );
  });
});

describe('SshExecutionContext', () => {
  function createContext() {
    const stream = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      destroy: ReturnType<typeof vi.fn>;
    };
    stream.stderr = new EventEmitter();
    stream.destroy = vi.fn();
    const exec = vi.fn((_command: string, callback: ClientCallback) => {
      callback(undefined, stream as unknown as ClientChannel);
    });
    const proxy = new SshClientProxy('test');
    proxy.update({ exec } as unknown as Client);
    vi.spyOn(proxy, 'getRemoteShellProfile').mockResolvedValue({
      shell: '/bin/sh',
      env: {},
    });
    return { context: new SshExecutionContext(proxy), exec, stream };
  }

  it('resolves only for an explicit zero exit status', async () => {
    const { context, exec, stream } = createContext();
    const result = context.exec('true');
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());

    stream.emit('close', 0);

    await expect(result).resolves.toEqual({ stdout: '', stderr: '' });
  });

  it.each([
    { code: 1, signal: undefined, message: 'Process exited with code 1' },
    { code: null, signal: 'SIGTERM', message: 'Process terminated by signal SIGTERM' },
    { code: undefined, signal: undefined, message: 'SSH process closed without exit status' },
  ])('rejects an SSH close with $message', async ({ code, signal, message }) => {
    const { context, exec, stream } = createContext();
    const result = context.exec('false');
    await vi.waitFor(() => expect(exec).toHaveBeenCalledOnce());

    stream.emit('close', code, signal);

    await expect(result).rejects.toThrow(message);
  });
});
