import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyExitChannel } from '@shared/events/ptyEvents';
import { makePtySessionId } from '@shared/ptySessionId';
import { createScriptTerminalId } from '@shared/terminals';
import { events } from '@main/lib/events';
import type { Pty, PtyExitInfo } from '../pty/pty';
import { ptySessionRegistry } from '../pty/pty-session-registry';
import type { TerminalProvider } from '../terminals/terminal-provider';
import { TaskLifecycleService } from './task-lifecycle-service';

vi.mock('@shared/terminals', () => ({
  createScriptTerminalId: vi.fn(
    async ({ type, script }: { type: string; script: string }) => `script-${type}-${script}`
  ),
}));

vi.mock('@main/lib/events', () => ({
  events: {
    once: vi.fn(),
  },
}));

vi.mock('../pty/pty-session-registry', () => ({
  ptySessionRegistry: {
    get: vi.fn(),
  },
}));

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
}

function makeTerminalProvider(overrides: Partial<TerminalProvider> = {}): {
  provider: TerminalProvider;
  spawnLifecycleScript: ReturnType<typeof vi.fn>;
} {
  const baseSpawnLifecycleScript = vi.fn(async () => {});
  const provider: TerminalProvider = {
    spawnTerminal: vi.fn(async () => {}),
    spawnLifecycleScript: baseSpawnLifecycleScript,
    killTerminal: vi.fn(async () => {}),
    destroyAll: vi.fn(async () => {}),
    detachAll: vi.fn(async () => {}),
    ...overrides,
  };
  return {
    provider,
    spawnLifecycleScript: provider.spawnLifecycleScript as unknown as ReturnType<typeof vi.fn>,
  };
}

function makeService(terminals: TerminalProvider): TaskLifecycleService {
  return new TaskLifecycleService({
    projectId: 'proj-1',
    taskId: 'task-1',
    terminals,
  });
}

describe('TaskLifecycleService', () => {
  let activePty: MockPty | undefined;
  let exitListener: ((info?: unknown) => void) | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    activePty = undefined;
    exitListener = undefined;

    vi.mocked(createScriptTerminalId).mockImplementation(
      async ({ type, script }: { type: string; script: string }) => `script-${type}-${script}`
    );
    vi.mocked(ptySessionRegistry.get).mockImplementation(() => activePty);
    vi.mocked(events.once).mockImplementation((_, cb) => {
      exitListener = cb as (info?: unknown) => void;
      return () => {};
    });
  });

  describe('prepareLifecycleScript', () => {
    it('creates a prepared script session for setup', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider();
      const service = makeService(provider);

      await service.prepareLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(createScriptTerminalId).toHaveBeenCalledWith({
        projectId: 'proj-1',
        taskId: 'task-1',
        type: 'setup',
        script: 'npm install',
      });
      expect(spawnLifecycleScript).toHaveBeenCalledWith({
        terminal: {
          id: 'script-setup-npm install',
          projectId: 'proj-1',
          taskId: 'task-1',
          name: 'setup',
        },
        command: '',
        initialSize: { cols: 80, rows: 24 },
        respawnOnExit: false,
        preserveBufferOnExit: true,
        watchDevServer: false,
      });
    });

    it('enables dev-server watcher for run scripts', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider();
      const service = makeService(provider);

      await service.prepareLifecycleScript({ type: 'run', script: 'pnpm dev' });

      expect(spawnLifecycleScript).toHaveBeenCalledWith(
        expect.objectContaining({
          watchDevServer: true,
        })
      );
    });
  });

  describe('runLifecycleScript', () => {
    it('writes to an already prepared PTY session', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider();
      const service = makeService(provider);
      activePty = new MockPty();

      await service.runLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLifecycleScript).not.toHaveBeenCalled();
      expect(activePty.written).toEqual(['npm install\n']);
    });

    it('self-heals by preparing when the session is missing', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider({
        spawnLifecycleScript: vi.fn(async () => {
          activePty = new MockPty();
        }),
      });
      const service = makeService(provider);

      await service.runLifecycleScript({ type: 'setup', script: 'npm install' });

      expect(spawnLifecycleScript).toHaveBeenCalledTimes(1);
      expect(activePty?.written).toEqual(['npm install\n']);
    });

    it('passes through custom initialSize during self-heal prepare', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider({
        spawnLifecycleScript: vi.fn(async () => {
          activePty = new MockPty();
        }),
      });
      const service = makeService(provider);

      await service.runLifecycleScript(
        { type: 'setup', script: 'npm install' },
        { initialSize: { cols: 120, rows: 40 } }
      );

      expect(spawnLifecycleScript).toHaveBeenCalledWith(
        expect.objectContaining({
          initialSize: { cols: 120, rows: 40 },
        })
      );
    });

    it('appends "; exit" when exit=true', async () => {
      const { provider } = makeTerminalProvider();
      const service = makeService(provider);
      activePty = new MockPty();

      await service.runLifecycleScript({ type: 'teardown', script: 'cleanup.sh' }, { exit: true });

      expect(activePty.written).toEqual(['cleanup.sh; exit\n']);
    });

    it('waits for pty exit when waitForExit=true', async () => {
      const { provider } = makeTerminalProvider();
      const service = makeService(provider);
      activePty = new MockPty();

      const promise = service.runLifecycleScript(
        { type: 'teardown', script: 'cleanup.sh' },
        { waitForExit: true, exit: true }
      );

      await vi.waitFor(() => {
        expect(events.once).toHaveBeenCalledWith(
          ptyExitChannel,
          expect.any(Function),
          makePtySessionId('proj-1', 'task-1', 'script-teardown-cleanup.sh')
        );
      });

      let resolved = false;
      void promise.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);

      exitListener?.({ exitCode: 0 });
      await promise;
    });

    it('throws when no PTY is available after self-heal attempt', async () => {
      const { provider } = makeTerminalProvider();
      const service = makeService(provider);

      await expect(
        service.runLifecycleScript({ type: 'setup', script: 'npm install' })
      ).rejects.toThrow('Lifecycle script session unavailable');
    });
  });

  describe('prepareAndRunLifecycleScript', () => {
    it('prepares and runs in one call', async () => {
      const { provider, spawnLifecycleScript } = makeTerminalProvider({
        spawnLifecycleScript: vi.fn(async () => {
          activePty = new MockPty();
        }),
      });
      const service = makeService(provider);

      await service.prepareAndRunLifecycleScript({ type: 'run', script: 'pnpm dev' });

      expect(spawnLifecycleScript).toHaveBeenCalledTimes(1);
      expect(activePty?.written).toEqual(['pnpm dev\n']);
    });
  });
});
