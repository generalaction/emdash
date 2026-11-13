import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { CygwinAgent, PageantAgent, type BaseAgent } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';

// On Windows ssh2 runs console helpers for some agents: pagent.exe on every Pageant request and
// cygpath for Cygwin agent sockets. Our main process and workers have no console, so a helper
// spawned without `windowsHide` opens its own console window. patches/ssh2@<version>.patch adds
// the flag; these tests keep it across ssh2 bumps. No real helper runs here.

// Node's spawn() and execFile() both hand their final options to this undocumented method, so
// stubbing it shows exactly how a helper would be started, however ssh2 got hold of spawn().
interface ChildProcessInternals {
  spawn(options: { file: string; args: string[]; windowsHide: boolean }): void;
}

// 11 is pagent.exe's "Pageant is not running"; any non-zero exit fails cygpath.
const HELPER_UNAVAILABLE = 11;

function stubProcessCreation() {
  const prototype = ChildProcess.prototype as ChildProcess & ChildProcessInternals;
  return vi.spyOn(prototype, 'spawn').mockImplementation(function (this: ChildProcess) {
    this.stdin = new PassThrough();
    this.stdout = new PassThrough();
    setImmediate(() => this.emit('close', HELPER_UNAVAILABLE));
  });
}

function identitiesError(agent: BaseAgent): Promise<Error | undefined> {
  return new Promise((resolve) => agent.getIdentities((error) => resolve(error ?? undefined)));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ssh2 agent helper processes', () => {
  // Upstream removed Pageant support after 1.17.0 (mscdex/ssh2@2267a4e); drop this case with it.
  it('hides the pagent.exe console window for Pageant requests', async () => {
    const spawn = stubProcessCreation();

    const error = await identitiesError(new PageantAgent('pageant'));

    expect(error).toBeInstanceOf(Error);
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({ file: expect.stringMatching(/pagent\.exe$/), windowsHide: true })
    );
  });

  it('hides the cygpath console window when resolving a Cygwin socket path', async () => {
    const spawn = stubProcessCreation();
    const socketPath = '/tmp/emdash-missing-cygwin-agent.sock';

    const error = await identitiesError(new CygwinAgent(socketPath));

    expect(error?.message).toBe('Invalid cygwin unix socket path');
    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'cygpath',
        args: ['cygpath', '-w', socketPath],
        windowsHide: true,
      })
    );
  });
});
