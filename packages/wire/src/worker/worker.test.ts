import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { LogFields, LogLevel, Logger } from '@emdash/shared/logger';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createController } from '../api/controller';
import { defineContract, procedure } from '../api/define';
import type {
  ManagedProcess,
  ManagedProcessExit,
  ProcessHost,
  ProcessSpec,
  StdioStream,
} from '../process';
import { createScope } from '../util';
import { serveWorkerProcess, type ProcessRuntimePort } from '../util/process-runtime';
import { lazyWorker } from './lazy-worker';
import { spawnWorker } from './spawn-worker';

const api = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
});

describe('worker utilities', () => {
  it('spawns a scoped worker and forwards structured runtime logs', async () => {
    const host = new FakeProcessHost();
    const { logger, calls } = createRecordingLogger();
    const scope = createScope({ label: 'root', logger });
    const pending = spawnWorker({
      name: 'demo',
      contract: api,
      entry: 'worker',
      host,
      scope,
    });
    await Promise.resolve();
    await startChild(host.process());

    const worker = await pending;
    host.process().emitStdio('stderr', '{"level":"info","msg":"child ready"}\n');

    expect(host.process().spec.supervision).toEqual({
      restart: 'on-failure',
      backoffMs: [250, 1_000, 2_500],
      maxRestarts: 5,
    });
    expect(calls).toContainEqual({
      level: 'info',
      message: 'child ready',
      fields: { scope: 'root/worker:demo', source: 'demo-runtime' },
    });
    await expect(worker.client.ping('one')).resolves.toBe('pong:one');

    await scope.dispose();
    expect(host.process().disposed).toBe(true);
  });

  it('reports restarts and terminal exits separately', async () => {
    const host = new FakeProcessHost();
    const pending = spawnWorker({ name: 'demo', contract: api, entry: 'worker', host });
    await Promise.resolve();
    await startChild(host.process());
    const worker = await pending;
    const restarted = waitForRestarted(worker);

    host.process().emitExit({ code: 1, willRestart: true });
    await startChild(host.process());

    await restarted;
    const exited = worker.whenExited;
    host.process().emitExit({ code: 2, willRestart: false });

    await expect(exited).resolves.toEqual({ code: 2, signal: undefined });
    await worker.dispose();
  });

  it('dedupes lazy spawn requests and retries after a failed spawn', async () => {
    const host = new FakeProcessHost();
    let attempts = 0;
    const worker = lazyWorker(() => {
      attempts += 1;
      return {
        name: 'demo',
        contract: api,
        entry: 'worker',
        host: attempts === 1 ? new FailingProcessHost() : host,
      };
    });

    await expect(worker.get()).rejects.toThrow('spawn failed');
    expect(attempts).toBe(1);

    const first = worker.get();
    const second = worker.get();
    expect(second).toBe(first);
    await Promise.resolve();
    await startChild(host.process());

    await expect(first).resolves.toMatchObject({ process: host.process() });
    expect(attempts).toBe(2);
    await worker.dispose();
    expect(host.process().disposed).toBe(true);
  });
});

async function startChild(process: FakeManagedProcess): Promise<void> {
  await serveWorkerProcess(
    () =>
      createController(api, {
        ping: (value) => `pong:${value}`,
      }),
    {
      port: process.createChildPort(),
      exit: (code) => process.emitExit({ code, willRestart: false }),
    }
  );
}

function waitForRestarted(worker: { onRestarted(cb: () => void): Unsubscribe }): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = worker.onRestarted(() => {
      unsubscribe();
      resolve();
    });
  });
}

type LogCall = {
  level: LogLevel;
  message: string;
  fields?: LogFields;
};

function createRecordingLogger(
  bindings: LogFields = {},
  calls: LogCall[] = []
): { logger: Logger; calls: LogCall[] } {
  const logger: Logger = {
    level: 'debug',
    debug: (message, fields) =>
      calls.push({ level: 'debug', message, fields: { ...bindings, ...fields } }),
    info: (message, fields) =>
      calls.push({ level: 'info', message, fields: { ...bindings, ...fields } }),
    warn: (message, fields) =>
      calls.push({ level: 'warn', message, fields: { ...bindings, ...fields } }),
    error: (message, fields) =>
      calls.push({ level: 'error', message, fields: { ...bindings, ...fields } }),
    child: (next) => createRecordingLogger({ ...bindings, ...next }, calls).logger,
  };
  return { logger, calls };
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

class FailingProcessHost implements ProcessHost {
  async spawn(): Promise<ManagedProcess> {
    throw new Error('spawn failed');
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

  emitStdio(stream: StdioStream, chunk: string): void {
    this.stdioEmitter.emit({ stream, chunk });
  }
}
