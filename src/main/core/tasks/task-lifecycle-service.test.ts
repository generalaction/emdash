import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pty, PtyExitInfo } from '../pty/pty';
import type { TerminalProvider } from '../terminals/terminal-provider';
import { TaskLifecycleService } from './task-lifecycle-service';

// ── Mock PTY ────────────────────────────────────────────────────────────────

class MockPty implements Pty {
  written: string[] = [];
  private exitHandlers: Array<(info: PtyExitInfo) => void> = [];
  private dataHandlers: Array<(data: string) => void> = [];

  write(data: string): void {
    this.written.push(data);
  }
  resize(): void {}
  kill(): void {}
  onData(handler: (data: string) => void): void {
    this.dataHandlers.push(handler);
  }
  onExit(handler: (info: PtyExitInfo) => void): void {
    this.exitHandlers.push(handler);
  }

  simulateExit(info: PtyExitInfo = { exitCode: 0 }): void {
    for (const h of this.exitHandlers) h(info);
  }
  simulateData(data: string): void {
    for (const h of this.dataHandlers) h(data);
  }
}

// ── Module mocks ────────────────────────────────────────────────────────────

let lastSpawnedPty: MockPty;

vi.mock('../pty/local-pty', () => ({
  spawnLocalPty: vi.fn(() => {
    lastSpawnedPty = new MockPty();
    return lastSpawnedPty;
  }),
}));

vi.mock('../pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
}));

vi.mock('../pty/pty-env', () => ({
  buildTerminalEnv: vi.fn(() => ({ TERM: 'xterm-256color' })),
}));

vi.mock('../terminals/dev-server-watcher', () => ({
  wireTerminalDevServerWatcher: vi.fn(),
}));

vi.mock('../pty/tmux-session-name', () => ({
  makeTmuxSessionName: vi.fn((id: string) => `tmux-${id}`),
  killTmuxSession: vi.fn(),
}));

vi.mock('../pty/spawn-utils', () => ({
  buildTmuxParams: vi.fn((shell: string, sessionName: string, cmd: string, cwd: string) => ({
    command: shell,
    args: ['-c', `tmux ${sessionName} ${cmd}`],
    cwd,
  })),
}));

vi.mock('@shared/terminals', () => ({
  createScriptTerminalId: vi.fn(
    async ({ type, script }: { type: string; script: string }) => `script-${type}-${script}`
  ),
}));

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeTerminalProvider(): TerminalProvider {
  return {
    spawnTerminal: vi.fn(),
    destroyAll: vi.fn(),
    detachAll: vi.fn(),
  } as unknown as TerminalProvider;
}

function makeService(
  overrides: Partial<ConstructorParameters<typeof TaskLifecycleService>[0]> = {}
) {
  return new TaskLifecycleService({
    projectId: 'proj-1',
    taskId: 'task-1',
    taskPath: '/workspace',
    terminals: makeTerminalProvider(),
    exec: vi.fn(),
    ...overrides,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('TaskLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('prepareLifecycleScript', () => {
    it('spawns an idle PTY with exec $SHELL', async () => {
      const { spawnLocalPty } = await import('../pty/local-pty');
      const service = makeService();

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
      const opts = vi.mocked(spawnLocalPty).mock.calls[0][0];
      expect(opts.args).toEqual(expect.arrayContaining(['-c']));
      const shellCmd = opts.args[opts.args.indexOf('-c') + 1];
      expect(shellCmd).toMatch(/^exec\s/);
      expect(shellCmd).not.toContain('npm install');
    });

    it('registers the PTY in ptySessionRegistry with preserveBufferOnExit', async () => {
      const { ptySessionRegistry } = await import('../pty/pty-session-registry');
      const service = makeService();

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(ptySessionRegistry.register).toHaveBeenCalledWith(expect.any(String), lastSpawnedPty, {
        preserveBufferOnExit: true,
      });
    });

    it('is idempotent — second call returns early', async () => {
      const { spawnLocalPty } = await import('../pty/local-pty');
      const service = makeService();

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });
      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
    });

    it('wires devServerWatcher for type "run"', async () => {
      const { wireTerminalDevServerWatcher } = await import('../terminals/dev-server-watcher');
      const service = makeService();

      await service.prepareLifecycleScript({ type: 'run', script: 'npm start' });

      expect(wireTerminalDevServerWatcher).toHaveBeenCalledWith(
        expect.objectContaining({ pty: lastSpawnedPty, taskId: 'task-1' })
      );
    });

    it('does NOT wire devServerWatcher for type "setup"', async () => {
      const { wireTerminalDevServerWatcher } = await import('../terminals/dev-server-watcher');
      const service = makeService();

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(wireTerminalDevServerWatcher).not.toHaveBeenCalled();
    });

    it('passes taskEnvVars to the spawned PTY', async () => {
      const { spawnLocalPty } = await import('../pty/local-pty');
      const service = makeService({ taskEnvVars: { PORT: '3000' } });

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      const opts = vi.mocked(spawnLocalPty).mock.calls[0][0];
      expect(opts.env).toMatchObject({ PORT: '3000' });
    });
  });

  describe('executeLifecycleScript', () => {
    it('sends script command to existing PTY', async () => {
      const service = makeService();
      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });
      const pty = lastSpawnedPty;
      pty.written = [];

      await service.executeLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(pty.written).toEqual(['npm install\n']);
    });

    it('prepends shellSetup when configured', async () => {
      const service = makeService({ shellSetup: 'source ~/.nvm/nvm.sh' });
      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });
      const pty = lastSpawnedPty;
      pty.written = [];

      await service.executeLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(pty.written[0]).toBe('source ~/.nvm/nvm.sh && npm install\n');
    });

    it('with exit: true, appends "; exit" and resolves on PTY exit', async () => {
      const service = makeService();
      await service.prepareLifecycleScript({ type: 'teardown', script: 'cleanup.sh' });
      const pty = lastSpawnedPty;
      pty.written = [];

      const promise = service.executeLifecycleScript(
        { type: 'teardown', script: 'cleanup.sh' },
        { exit: true }
      );

      await Promise.resolve();

      expect(pty.written[0]).toBe('cleanup.sh; exit\n');

      let resolved = false;
      void promise.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      pty.simulateExit({ exitCode: 0 });
      await promise;
    });

    it('falls back to prepareLifecycleScript if no session exists', async () => {
      const { spawnLocalPty } = await import('../pty/local-pty');
      const service = makeService();

      await service.executeLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
      expect(lastSpawnedPty.written).toContain('npm install\n');
    });

    it('cleans up session from internal map on exit when exit: true', async () => {
      const service = makeService();
      await service.prepareLifecycleScript({ type: 'teardown', script: 'cleanup.sh' });
      const pty = lastSpawnedPty;

      const promise = service.executeLifecycleScript(
        { type: 'teardown', script: 'cleanup.sh' },
        { exit: true }
      );

      await Promise.resolve();

      pty.simulateExit({ exitCode: 0 });
      await promise;

      const { spawnLocalPty } = await import('../pty/local-pty');
      vi.mocked(spawnLocalPty).mockClear();
      await service.prepareLifecycleScript({ type: 'teardown', script: 'cleanup.sh' });
      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
    });
  });

  describe('runLifecycleScript', () => {
    it('spawns PTY and executes script in one call', async () => {
      const { spawnLocalPty } = await import('../pty/local-pty');
      const service = makeService();

      await service.runLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLocalPty).toHaveBeenCalledTimes(1);
      expect(lastSpawnedPty.written).toContain('npm install\n');
    });
  });
});
