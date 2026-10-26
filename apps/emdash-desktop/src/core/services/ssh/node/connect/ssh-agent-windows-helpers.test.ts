import childProcess, { ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { PassThrough } from 'node:stream';
import type { BaseAgent, CygwinAgent, PageantAgent } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';

// On Windows ssh2 runs console helpers for some agents: pagent.exe on every Pageant request and
// cygpath for Cygwin agent sockets. Our main process and workers have no console, so a helper
// spawned without `windowsHide` opens its own console window. patches/ssh2@<version>.patch adds
// the flag; these tests keep it across ssh2 bumps. No real helper runs here.

const require = createRequire(import.meta.url);
const AGENT_MODULE = require.resolve('ssh2/lib/agent.js');

interface AgentModule {
  CygwinAgent: typeof CygwinAgent;
  PageantAgent: typeof PageantAgent;
}

// agent.js destructures spawn/execFile from child_process when it loads, so stub those on the
// shared module object first, then load a private copy of agent.js and leave the cached one as is.
function loadAgentModule(): AgentModule {
  const shared = require.cache[AGENT_MODULE];
  delete require.cache[AGENT_MODULE];
  try {
    return require(AGENT_MODULE);
  } finally {
    require.cache[AGENT_MODULE] = shared;
  }
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
    const spawn = vi.spyOn(childProcess, 'spawn').mockImplementation(() => {
      const proc = new ChildProcess();
      proc.stdin = new PassThrough();
      proc.stdout = new PassThrough();
      // pagent.exe exit code for "Pageant is not running".
      setImmediate(() => proc.emit('close', 11));
      return proc;
    });
    const { PageantAgent } = loadAgentModule();

    const error = await identitiesError(new PageantAgent('pageant'));

    expect(error).toBeInstanceOf(Error);
    expect(spawn).toHaveBeenCalledWith(
      expect.stringMatching(/pagent\.exe$/),
      expect.any(Array),
      expect.objectContaining({ windowsHide: true })
    );
  });

  it('hides the cygpath console window when resolving a Cygwin socket path', async () => {
    const execFile = vi
      .spyOn(childProcess, 'execFile')
      .mockImplementation((_file, _args, _options, callback) => {
        callback?.(Object.assign(new Error('spawn cygpath ENOENT'), { code: 'ENOENT' }), '', '');
        return new ChildProcess();
      });
    const { CygwinAgent } = loadAgentModule();
    const socketPath = '/tmp/emdash-missing-cygwin-agent.sock';

    const error = await identitiesError(new CygwinAgent(socketPath));

    expect(error?.message).toBe('Invalid cygwin unix socket path');
    expect(execFile).toHaveBeenCalledWith(
      'cygpath',
      ['-w', socketPath],
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function)
    );
  });
});
