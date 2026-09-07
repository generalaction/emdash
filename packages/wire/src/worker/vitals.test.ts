import type { Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import { recordSpawn, setSpawnObserver } from '@emdash/shared/perf';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installWorkerVitals, type WorkerVitalsPort } from './node/vitals';
import type { ProcessExit, WorkerProcess, WorkerProcessSpawner, WorkerProcessSpec } from './types';
import { WORKER_NAME_ENV_VAR } from './types';
import {
  createVitalsCollectingSpawner,
  isWorkerSpawnLogToggle,
  isWorkerVitalsStart,
  workerSpawnLogToggle,
  workerVitalsReport,
  workerVitalsStart,
} from './vitals';

function fakeWorkerProcess(): WorkerProcess & {
  sent: unknown[];
  emitMessage(message: unknown): void;
  emitExit(): void;
} {
  const sent: unknown[] = [];
  const messageHandlers: Array<(message: unknown) => void> = [];
  const exitHandlers: Array<(exit: ProcessExit) => void> = [];
  return {
    pid: 123,
    sent,
    send(message) {
      sent.push(message);
    },
    onMessage(cb) {
      messageHandlers.push(cb);
      return () => {};
    },
    onExit(cb) {
      exitHandlers.push(cb);
      return () => {};
    },
    onStdio() {
      return () => {};
    },
    kill() {},
    emitMessage(message) {
      for (const handler of messageHandlers) handler(message);
    },
    emitExit() {
      for (const handler of exitHandlers) handler({ code: 0, signal: null });
    },
  };
}

function fakeSpawner(processes: WorkerProcess[]): WorkerProcessSpawner {
  return {
    async spawn() {
      return processes.shift()!;
    },
  };
}

const scope = {} as Scope;

function spec(name: string): WorkerProcessSpec {
  return { entry: '/tmp/worker.js', env: { [WORKER_NAME_ENV_VAR]: name } };
}

describe('createVitalsCollectingSpawner', () => {
  it('forwards worker vitals reports tagged with the worker name', async () => {
    const child = fakeWorkerProcess();
    const onReport = vi.fn();
    const spawner = createVitalsCollectingSpawner(fakeSpawner([child]), { onReport });

    await spawner.spawn(spec('git'), scope);
    child.emitMessage(workerVitalsReport({ rss_mb: 42 }));
    child.emitMessage({ unrelated: true });

    expect(onReport).toHaveBeenCalledTimes(1);
    expect(onReport).toHaveBeenCalledWith('git', { rss_mb: 42 });
  });

  it('sends no start message until sampling is activated', async () => {
    const child = fakeWorkerProcess();
    const spawner = createVitalsCollectingSpawner(fakeSpawner([child]), { onReport: vi.fn() });

    await spawner.spawn(spec('git'), scope);
    expect(child.sent).toEqual([]);

    spawner.startSampling(300_000);
    expect(child.sent).toHaveLength(1);
    expect(isWorkerVitalsStart(child.sent[0])).toBe(true);
    expect((child.sent[0] as { intervalMs: number }).intervalMs).toBe(300_000);
  });

  it('sends the start message to workers spawned after activation (restarts)', async () => {
    const first = fakeWorkerProcess();
    const second = fakeWorkerProcess();
    const spawner = createVitalsCollectingSpawner(fakeSpawner([first, second]), {
      onReport: vi.fn(),
    });

    await spawner.spawn(spec('acp'), scope);
    spawner.startSampling(300_000);
    first.emitExit();

    await spawner.spawn(spec('acp'), scope);
    expect(second.sent).toHaveLength(1);
    expect(isWorkerVitalsStart(second.sent[0])).toBe(true);
  });

  it('broadcasts spawn-log toggles to live and future workers', async () => {
    const first = fakeWorkerProcess();
    const second = fakeWorkerProcess();
    const spawner = createVitalsCollectingSpawner(fakeSpawner([first, second]), {
      onReport: vi.fn(),
    });

    await spawner.spawn(spec('git'), scope);
    spawner.setSpawnLogging(true);
    expect(first.sent).toEqual([workerSpawnLogToggle(true)]);

    await spawner.spawn(spec('acp'), scope);
    expect(second.sent).toEqual([workerSpawnLogToggle(true)]);

    spawner.setSpawnLogging(false);
    expect(first.sent[1]).toEqual(workerSpawnLogToggle(false));
    expect(isWorkerSpawnLogToggle(first.sent[1])).toBe(true);
  });
});

describe('installWorkerVitals', () => {
  function fakePort(): WorkerVitalsPort & {
    sent: unknown[];
    emitMessage(message: unknown): void;
  } {
    const sent: unknown[] = [];
    const handlers: Array<(message: unknown) => void> = [];
    return {
      sent,
      send(message) {
        sent.push(message);
      },
      onMessage(cb) {
        handlers.push(cb);
      },
      emitMessage(message) {
        for (const handler of handlers) handler(message);
      },
    };
  }

  it('creates no sampling instruments until the start message arrives', () => {
    const port = fakePort();
    const startReporting = vi.fn(() => ({ dispose: vi.fn() }));

    installWorkerVitals({ port, startReporting });
    port.emitMessage({ some: 'noise' });

    expect(startReporting).not.toHaveBeenCalled();
    expect(port.sent).toEqual([]);
  });

  it('starts reporting on the requested cadence and sends reports over the port', () => {
    const port = fakePort();
    let capturedReport: ((vitals: Record<string, number>) => void) | null = null;
    const startReporting = vi.fn(
      (options: { intervalMs: number; report(vitals: Record<string, number>): void }) => {
        capturedReport = options.report;
        return { dispose: vi.fn() };
      }
    );

    installWorkerVitals({ port, startReporting });
    port.emitMessage(workerVitalsStart(300_000));

    expect(startReporting).toHaveBeenCalledTimes(1);
    expect(startReporting.mock.calls[0]![0].intervalMs).toBe(300_000);

    capturedReport!({ rss_mb: 17, interval_ms: 300_000 });
    expect(port.sent).toEqual([workerVitalsReport({ rss_mb: 17, interval_ms: 300_000 })]);
  });

  describe('spawn-log toggle', () => {
    afterEach(() => {
      setSpawnObserver(null);
    });

    function stubLogger(): Logger & { infoCalls: unknown[][] } {
      const infoCalls: unknown[][] = [];
      const logger = {
        level: 'info',
        infoCalls,
        debug: vi.fn(),
        info: (...args: unknown[]) => {
          infoCalls.push(args);
        },
        warn: vi.fn(),
        error: vi.fn(),
        child: () => logger,
      };
      return logger as unknown as Logger & { infoCalls: unknown[][] };
    }

    it('logs each spawn with its purpose tag while enabled, and stops when disabled', () => {
      const port = fakePort();
      const logger = stubLogger();
      installWorkerVitals({ port, logger, startReporting: vi.fn(() => ({ dispose: vi.fn() })) });

      recordSpawn('git', 'git status');
      expect(logger.infoCalls).toHaveLength(0);

      port.emitMessage(workerSpawnLogToggle(true));
      recordSpawn('git', 'git status');
      expect(logger.infoCalls).toEqual([['perf.spawn', { purpose: 'git', command: 'git status' }]]);

      port.emitMessage(workerSpawnLogToggle(false));
      recordSpawn('tmux');
      expect(logger.infoCalls).toHaveLength(1);
    });
  });
});
