import { Emitter, type Unsubscribe } from '@emdash/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createController } from '../../api/controller';
import { defineContract, liveModel, liveState, procedure } from '../../api/define';
import { createLiveModelHost } from '../../live/mutations';
import { ReplicaState } from '../../live/replica';
import type {
  ManagedProcess,
  ManagedProcessExit,
  ProcessHost,
  ProcessSpec,
  StdioStream,
} from '../../process/types';
import { createScope } from '../scope';
import {
  RUNTIME_SHUTDOWN_SIGNAL,
  serveProcessRuntime,
  spawnRuntime,
  type ProcessRuntimePort,
} from './process-runtime';

const keySchema = z.object({ id: z.string() });
const stateSchema = z.object({ count: z.number() });
const api = defineContract({
  ping: procedure({ input: z.string(), output: z.string() }),
  counter: liveModel({
    key: keySchema,
    states: { state: liveState({ data: stateSchema }) },
  }),
});

describe('process runtime utilities', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the child ready signal and exposes a typed client', async () => {
    const host = new FakeProcessHost();
    const pending = spawnRuntime({ host, contract: api, spec: { entry: 'worker' } });
    await Promise.resolve();
    await startChild(host.process(), { count: 0 });

    const runtime = await pending;

    await expect(runtime.client.ping('one')).resolves.toBe('pong:one');
    expect(host.process().spec.gracefulShutdown?.message).toEqual(RUNTIME_SHUTDOWN_SIGNAL);
    await runtime.dispose();
  });

  it('disposes the process when the child never becomes ready', async () => {
    vi.useFakeTimers();
    const host = new FakeProcessHost();
    const pending = spawnRuntime({
      host,
      contract: api,
      spec: { entry: 'worker' },
      readyTimeoutMs: 5,
    });
    const caught = pending.catch((error: unknown) => error);
    await Promise.resolve();

    await vi.advanceTimersByTimeAsync(5);

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Runtime did not become ready');
    expect(host.process().disposed).toBe(true);
  });

  it('disposes the process when it exits before becoming ready', async () => {
    const host = new FakeProcessHost();
    const pending = spawnRuntime({ host, contract: api, spec: { entry: 'worker' } });
    const caught = pending.catch((error: unknown) => error);
    await Promise.resolve();

    host.process().emitExit({ code: 1, willRestart: false });

    const error = await caught;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('Runtime exited before ready');
    expect(host.process().disposed).toBe(true);
  });

  it('maps post-restart ready signals to reconnects and reattaches live models', async () => {
    const host = new FakeProcessHost();
    const pending = spawnRuntime({ host, contract: api, spec: { entry: 'worker' } });
    await Promise.resolve();
    await startChild(host.process(), { count: 0 });
    const runtime = await pending;

    const restarted = waitForRestarted(runtime);
    const seen: Array<{ count: number }> = [];
    const state = new ReplicaState(runtime.client.counter.state({ id: 'task' }, 'state'), {
      schema: stateSchema,
      onChange: (value) => seen.push(value),
    });
    await state.ready;
    expect(state.current()).toEqual({ count: 0 });

    host.process().emitExit({ code: 1, willRestart: true });
    await startChild(host.process(), { count: 9 });

    await restarted;
    await waitFor(() => attachCount(host.process().sentMessages) >= 2);
    await waitFor(() => state.current().count === 9);
    expect(seen.at(-1)).toEqual({ count: 9 });

    await state.dispose();
    await runtime.dispose();
  });

  it('sends the runtime shutdown signal and lets the child dispose its scope', async () => {
    const host = new FakeProcessHost();
    let childDisposed = false;
    const pending = spawnRuntime({ host, contract: api, spec: { entry: 'worker' } });
    await Promise.resolve();
    await startChild(host.process(), { count: 0 }, () => {
      childDisposed = true;
    });
    const runtime = await pending;

    await runtime.dispose();

    expect(host.process().sentMessages).toContainEqual(RUNTIME_SHUTDOWN_SIGNAL);
    expect(childDisposed).toBe(true);
  });

  it('disposes the runtime when the parent scope is disposed', async () => {
    const host = new FakeProcessHost();
    const scope = createScope();
    const pending = spawnRuntime({ host, contract: api, spec: { entry: 'worker' }, scope });
    await Promise.resolve();
    await startChild(host.process(), { count: 0 });
    await pending;

    await scope.dispose();

    expect(host.process().disposed).toBe(true);
  });
});

async function startChild(
  process: FakeManagedProcess,
  state: { count: number },
  onDispose?: () => void
): Promise<void> {
  const host = createLiveModelHost(api.counter);
  host.create({ id: 'task' }, { state });
  await serveProcessRuntime(
    async (scope) => {
      if (onDispose) scope.add(onDispose);
      return createController(api, {
        ping: (value) => `pong:${value}`,
        counter: host,
      });
    },
    {
      port: process.createChildPort(),
      exit: (code) => process.emitExit({ code, willRestart: false }),
    }
  );
}

function waitForRestarted(runtime: { onRestarted(cb: () => void): Unsubscribe }): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = runtime.onRestarted(() => {
      unsubscribe();
      resolve();
    });
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for condition');
}

function attachCount(messages: unknown[]): number {
  return messages.filter((message) => (message as { kind?: unknown }).kind === 'attach').length;
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
