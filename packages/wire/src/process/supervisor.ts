import { Emitter, type Unsubscribe } from '@emdash/shared';
import { createScope, type Scope } from '../util';
import type {
  ChildHandle,
  ManagedProcess,
  ManagedProcessExit,
  ProcessExit,
  ProcessSpec,
  SpawnChild,
  StdioStream,
} from './types';

type CurrentChild = {
  handle: ChildHandle;
  scope: Scope;
};

export async function createSupervisedProcess(
  spec: ProcessSpec,
  spawnChild: SpawnChild,
  parentScope?: Scope
): Promise<ManagedProcess> {
  const process = new SupervisedProcess(spec, spawnChild);
  await process.start();
  parentScope?.use(process);
  return process;
}

class SupervisedProcess implements ManagedProcess {
  private readonly scope: Scope;
  private readonly messageEmitter = new Emitter<unknown>();
  private readonly exitEmitter = new Emitter<ManagedProcessExit>();
  private readonly stdioEmitter = new Emitter<{ stream: StdioStream; chunk: string }>();
  private current: CurrentChild | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private restartAttempts = 0;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(
    private readonly spec: ProcessSpec,
    private readonly spawnChild: SpawnChild
  ) {
    this.scope = createScope({ label: `process:${spec.entry}` });
  }

  get pid(): number | undefined {
    return this.current?.handle.pid;
  }

  async start(): Promise<void> {
    await this.spawnAttempt();
  }

  send(message: unknown): void {
    const child = this.current?.handle;
    if (!child) throw new Error('Managed process is not running');
    child.send(message);
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    return this.messageEmitter.subscribe(cb);
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
    this.disposePromise = this.disposeAll();
    return this.disposePromise;
  }

  private async spawnAttempt(): Promise<void> {
    if (this.disposed) return;
    const attemptScope = this.scope.child('attempt');
    const handle = await this.spawnChild(this.spec, attemptScope);
    if (this.disposed) {
      await attemptScope.dispose();
      await handle.kill();
      return;
    }

    this.current = { handle, scope: attemptScope };
    attemptScope.add(handle.onMessage((message) => this.messageEmitter.emit(message)));
    attemptScope.add(handle.onStdio((stream, chunk) => this.stdioEmitter.emit({ stream, chunk })));
    attemptScope.add(
      handle.onExit((exit) => {
        void this.handleExit(handle, exit);
      })
    );
  }

  private async handleExit(handle: ChildHandle, exit: ProcessExit): Promise<void> {
    const current = this.current;
    if (!current || current.handle !== handle) return;
    this.current = undefined;
    await current.scope.dispose();

    const willRestart = this.shouldRestart(exit);
    this.exitEmitter.emit({ ...exit, willRestart });
    if (willRestart) this.scheduleRestart();
  }

  private shouldRestart(exit: ProcessExit): boolean {
    if (this.disposed) return false;
    const supervision = this.spec.supervision ?? { restart: 'never' as const };
    if (supervision.restart !== 'on-failure') return false;
    const failed = exit.code !== 0 || exit.signal != null;
    if (!failed) return false;
    return supervision.maxRestarts === undefined || this.restartAttempts < supervision.maxRestarts;
  }

  private scheduleRestart(): void {
    const supervision = this.spec.supervision;
    if (!supervision || supervision.restart !== 'on-failure') return;
    const backoffMs = supervision.backoffMs ?? [0];
    const delay = backoffMs[Math.min(this.restartAttempts, backoffMs.length - 1)] ?? 0;
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = undefined;
      void this.spawnAttempt();
    }, delay);
  }

  private async disposeAll(): Promise<void> {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = undefined;
    }

    await this.stopCurrentChild();
    await this.scope.dispose();
    this.messageEmitter.clear();
    this.exitEmitter.clear();
    this.stdioEmitter.clear();
  }

  private async stopCurrentChild(): Promise<void> {
    const current = this.current;
    if (!current) return;
    const handle = current.handle;
    const exitPromise = new Promise<void>((resolve) => {
      const unsubscribe = handle.onExit(() => {
        unsubscribe();
        resolve();
      });
    });

    const graceful = this.spec.gracefulShutdown;
    if (graceful?.message !== undefined) {
      try {
        handle.send(graceful.message);
      } catch {}
      await waitForExitOrTimeout(exitPromise, graceful.graceMs);
    }

    if (this.current?.handle === handle) {
      await handle.kill();
    }
  }
}

async function waitForExitOrTimeout(exitPromise: Promise<void>, ms: number): Promise<void> {
  if (ms <= 0) return;
  await Promise.race([
    exitPromise,
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
  ]);
}
