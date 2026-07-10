import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Emitter, type Unsubscribe } from '@emdash/shared';
import type {
  ManagedProcess,
  ManagedProcessExit,
  ProcessHost,
  ProcessSpec,
  StdioStream,
} from '@emdash/wire/process';
import { serveWorkerProcess, type ProcessRuntimePort } from '@emdash/wire/util/process-runtime';
import { describe, expect, it } from 'vitest';
import type { IWatchService, WatchEvent, WatchHandle, WatchOptions } from '../api';
import { createFsWatchController } from './controller';
import { processWatchBackend } from './process-backend';
import { createWatchService } from './watch-service';

describe('processWatchBackend', () => {
  it('delivers child events, dedupes same-key consumers, and unwatches on release', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-process-'));
    const host = new FakeProcessHost();
    const backend = processWatchBackend({ entry: 'worker', host });
    const service = createWatchService({ backend });
    const childService = new ManualWatchService();
    const firstEvents: WatchEvent[] = [];
    const secondEvents: WatchEvent[] = [];

    try {
      const first = service.watch(root, (events) => firstEvents.push(...events));
      await Promise.resolve();
      await startChild(host.process(), childService);
      await first.ready();
      const second = service.watch(root, (events) => secondEvents.push(...events));
      await second.ready();

      expect(childService.watchCount).toBe(1);
      childService.emit([{ kind: 'create', path: path.join(root, 'created.txt') }]);
      await eventually(() =>
        firstEvents.length === 1 && secondEvents.length === 1 ? true : undefined
      );

      await first.release();
      expect(childService.releaseCount).toBe(0);
      await second.release();
      await eventually(() => (childService.releaseCount === 1 ? true : undefined));
    } finally {
      await service.dispose();
    }
  });

  it('reattaches active watches and signals resync after child restart', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-restart-'));
    const host = new FakeProcessHost();
    const backend = processWatchBackend({ entry: 'worker', host });
    const service = createWatchService({ backend });
    const firstChildService = new ManualWatchService();
    const events: WatchEvent[] = [];
    let resyncs = 0;

    try {
      const handle = service.watch(root, (batch) => events.push(...batch), {
        onResync: () => {
          resyncs += 1;
        },
      });
      await Promise.resolve();
      await startChild(host.process(), firstChildService);
      await handle.ready();

      const restartedChildService = new ManualWatchService();
      host.process().emitExit({ code: 1, willRestart: true });
      await startChild(host.process(), restartedChildService);

      await eventually(() => (restartedChildService.watchCount === 1 ? true : undefined));
      await eventually(() => (resyncs === 1 ? true : undefined));

      restartedChildService.emit([{ kind: 'update', path: path.join(root, 'after-restart.txt') }]);
      await eventually(() => (events.length === 1 ? true : undefined));

      expect(resyncs).toBe(1);
      await handle.release();
    } finally {
      await service.dispose();
    }
  });

  it('rejects ready when the child watcher fails to start', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-failure-'));
    const host = new FakeProcessHost();
    const backend = processWatchBackend({ entry: 'worker', host });
    const service = createWatchService({ backend });
    const childService = new ManualWatchService({ readyError: new Error('watch failed') });

    try {
      const handle = service.watch(root, () => {});
      await Promise.resolve();
      await startChild(host.process(), childService);

      await expect(handle.ready()).rejects.toThrow('watch failed');
      await eventually(() => (childService.releaseCount === 1 ? true : undefined));
    } finally {
      await service.dispose();
    }
  });

  it('surfaces terminal reattach errors from the child worker', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-fs-watch-reattach-error-'));
    const host = new FakeProcessHost();
    const errors: Array<{ context: string; message: string }> = [];
    const backend = processWatchBackend({
      entry: 'worker',
      host,
      onError: (context, error) => {
        errors.push({
          context,
          message: error instanceof Error ? error.message : String(error),
        });
      },
    });
    const service = createWatchService({ backend });
    const childService = new ManualWatchService();

    try {
      const handle = service.watch(root, () => {});
      await Promise.resolve();
      await startChild(host.process(), childService);
      await handle.ready();

      host.process().emitExit({ code: 1, willRestart: true });
      await startBrokenChild(host.process());

      await eventually(() =>
        errors.some((error) => error.context.includes('reattach terminal')) ? true : undefined
      );
      expect(errors).toContainEqual({
        context: expect.stringContaining('reattach terminal'),
        message: expect.stringContaining('Unknown live topic'),
      });

      await handle.release();
    } finally {
      await service.dispose();
    }
  });
});

async function startChild(process: FakeManagedProcess, service: IWatchService): Promise<void> {
  await serveWorkerProcess(
    (scope) =>
      createFsWatchController({
        scope,
        service,
      }),
    {
      port: process.createChildPort(),
      exit: (code) => process.emitExit({ code, willRestart: false }),
    }
  );
}

async function startBrokenChild(process: FakeManagedProcess): Promise<void> {
  await serveWorkerProcess(
    () => ({
      call: () => {
        throw new Error('not implemented');
      },
      resolveLive: () => null,
    }),
    {
      port: process.createChildPort(),
      exit: (code) => process.emitExit({ code, willRestart: false }),
    }
  );
}

async function eventually<T>(
  read: () => T | undefined,
  timeoutMs = 5_000,
  intervalMs = 10
): Promise<T> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = read();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

class ManualWatchService implements IWatchService {
  watchCount = 0;
  releaseCount = 0;
  private current:
    | {
        onEvents: (events: WatchEvent[]) => void;
        onResync?: () => void;
        released: boolean;
      }
    | undefined;

  constructor(private readonly options: { readyError?: Error } = {}) {}

  watch(
    _root: string,
    onEvents: (events: WatchEvent[]) => void,
    options: WatchOptions = {}
  ): WatchHandle {
    this.watchCount += 1;
    const current = { onEvents, onResync: options.onResync, released: false };
    this.current = current;
    return {
      ready: async () => {
        if (this.options.readyError) throw this.options.readyError;
      },
      release: async () => {
        if (current.released) return;
        current.released = true;
        this.releaseCount += 1;
        if (this.current === current) this.current = undefined;
      },
    };
  }

  emit(events: WatchEvent[]): void {
    this.current?.onEvents(events);
  }

  async dispose(): Promise<void> {
    this.current = undefined;
  }
}

class FakeProcessHost implements ProcessHost {
  private spawned: FakeManagedProcess | undefined;

  async spawn(spec: ProcessSpec): Promise<ManagedProcess> {
    this.spawned = new FakeManagedProcess(spec);
    return this.spawned;
  }

  process(): FakeManagedProcess {
    if (!this.spawned) throw new Error('No process spawned');
    return this.spawned;
  }
}

class FakeManagedProcess implements ManagedProcess {
  readonly sentMessages: unknown[] = [];
  disposed = false;
  readonly pid = 1;
  private readonly parentMessages = new Emitter<unknown>();
  private readonly exitEmitter = new Emitter<ManagedProcessExit>();
  private readonly stdioEmitter = new Emitter<{ stream: StdioStream; chunk: string }>();
  private childMessages: Emitter<unknown> | undefined;
  private disposePromise: Promise<void> | undefined;
  private exited = false;

  constructor(readonly spec: ProcessSpec) {}

  send(message: unknown): void {
    this.sentMessages.push(message);
    this.childMessages?.emit(message);
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    return this.parentMessages.subscribe(cb);
  }

  onExit(cb: (exit: ManagedProcessExit) => void): Unsubscribe {
    return this.exitEmitter.subscribe(cb);
  }

  onStdio(cb: (stream: StdioStream, chunk: string) => void): Unsubscribe {
    return this.stdioEmitter.subscribe(({ stream, chunk }) => cb(stream, chunk));
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      if (this.spec.gracefulShutdown?.message !== undefined) {
        this.send(this.spec.gracefulShutdown.message);
        await Promise.resolve();
        await Promise.resolve();
      }
      if (!this.exited) this.emitExit({ code: null, willRestart: false });
    })();
    return this.disposePromise;
  }

  createChildPort(): ProcessRuntimePort {
    this.exited = false;
    const childMessages = new Emitter<unknown>();
    this.childMessages = childMessages;
    return {
      send: (message) => this.parentMessages.emit(message),
      onMessage: (cb) => childMessages.subscribe(cb),
      onDisconnect: () => () => {},
    };
  }

  emitExit(exit: ManagedProcessExit): void {
    this.exited = true;
    this.exitEmitter.emit(exit);
  }
}
