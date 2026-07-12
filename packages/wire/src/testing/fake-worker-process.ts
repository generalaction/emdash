import { Emitter, type Unsubscribe } from '@emdash/shared';
import type { Scope } from '../util';
import type {
  ProcessExit,
  WorkerParentPort,
  WorkerProcess,
  WorkerProcessSpawner,
  WorkerProcessSpec,
  WorkerStdioStream,
} from '../worker';

export class FakeWorkerProcessSpawner implements WorkerProcessSpawner {
  readonly processes: FakeWorkerProcess[] = [];
  failNextSpawnWith: unknown;

  async spawn(spec: WorkerProcessSpec, _scope: Scope): Promise<WorkerProcess> {
    if (this.failNextSpawnWith !== undefined) {
      const error = this.failNextSpawnWith;
      this.failNextSpawnWith = undefined;
      throw error;
    }
    const process = new FakeWorkerProcess(spec);
    this.processes.push(process);
    return process;
  }

  latest(): FakeWorkerProcess {
    const process = this.processes.at(-1);
    if (!process) throw new Error('FakeWorkerProcessSpawner has not spawned a process');
    return process;
  }
}

export class FakeWorkerProcess implements WorkerProcess {
  readonly parentMessages: unknown[] = [];
  readonly childMessages: unknown[] = [];
  readonly childPort: WorkerParentPort;
  readonly pid = 1_000 + Math.floor(Math.random() * 1_000);
  private readonly parentMessagesEmitter = new Emitter<unknown>();
  private readonly childMessagesEmitter = new Emitter<unknown>();
  private readonly exitEmitter = new Emitter<ProcessExit>();
  private readonly disconnectEmitter = new Emitter<void>();
  private readonly stdioEmitter = new Emitter<{ stream: WorkerStdioStream; chunk: string }>();
  private exited = false;

  constructor(readonly spec: WorkerProcessSpec) {
    this.childPort = {
      send: (message) => {
        this.childMessages.push(message);
        this.childMessagesEmitter.emit(message);
      },
      onMessage: (cb) => this.parentMessagesEmitter.subscribe(cb),
      onDisconnect: (cb) => this.disconnectEmitter.subscribe(cb),
    };
  }

  send(message: unknown): void {
    this.parentMessages.push(message);
    this.parentMessagesEmitter.emit(message);
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    return this.childMessagesEmitter.subscribe(cb);
  }

  onExit(cb: (exit: ProcessExit) => void): Unsubscribe {
    return this.exitEmitter.subscribe(cb);
  }

  onStdio(cb: (stream: WorkerStdioStream, chunk: string) => void): Unsubscribe {
    return this.stdioEmitter.subscribe(({ stream, chunk }) => cb(stream, chunk));
  }

  kill(): void {
    this.emitExit({ code: null, signal: 'SIGKILL' });
  }

  emitExit(exit: ProcessExit): void {
    if (this.exited) return;
    this.exited = true;
    this.exitEmitter.emit(exit);
    this.disconnectEmitter.emit();
  }

  emitStdio(stream: WorkerStdioStream, chunk: string): void {
    this.stdioEmitter.emit({ stream, chunk });
  }
}
