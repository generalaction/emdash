import { Emitter, type Unsubscribe } from '@emdash/shared';
import { isWireMessage, WireError, type WireMessage, type WireTransport } from '../api/protocol';
import { isWireWorkerFrame, RUNTIME_CHANNEL } from './component-protocol';
import { isWorkerSignal } from './protocol';
import type { ProcessExit, WorkerProcess } from './types';

type ActiveGeneration = {
  generation: number;
  process: WorkerProcess;
  ready: boolean;
  readySignaled: boolean;
};

export class WorkerLink implements WireTransport {
  private active: ActiveGeneration | undefined;
  private closed = false;
  private hasConnected = false;
  private readonly messageEmitter = new Emitter<WireMessage>();
  private readonly disconnectEmitter = new Emitter<void>();
  private readonly reconnectEmitter = new Emitter<void>();
  private readonly readyEmitter = new Emitter<number>();

  post(message: WireMessage): void {
    const active = this.active;
    if (this.closed || !active?.ready) {
      throw new WireError('DISCONNECTED', 'Wire worker is not ready');
    }
    active.process.send({
      kind: 'wire-worker-frame',
      channel: RUNTIME_CHANNEL,
      payload: message,
    });
  }

  onMessage(cb: (message: WireMessage) => void): Unsubscribe {
    return this.messageEmitter.subscribe(cb);
  }

  onDisconnect(cb: () => void): Unsubscribe {
    return this.disconnectEmitter.subscribe(cb);
  }

  onReconnect(cb: () => void): Unsubscribe {
    return this.reconnectEmitter.subscribe(cb);
  }

  onReady(cb: (generation: number) => void): Unsubscribe {
    return this.readyEmitter.subscribe(cb);
  }

  hasReadySignal(generation: number): boolean {
    return this.active?.generation === generation && this.active.readySignaled;
  }

  attach(generation: number, process: WorkerProcess): void {
    if (this.closed) return;
    this.active = { generation, process, ready: false, readySignaled: false };
  }

  handleMessage(generation: number, message: unknown): void {
    const active = this.active;
    if (!active || active.generation !== generation || this.closed) return;
    if (isWorkerSignal(message, 'ready')) {
      active.readySignaled = true;
      this.readyEmitter.emit(generation);
      return;
    }
    if (isWireWorkerFrame(message)) {
      if (message.channel === RUNTIME_CHANNEL && isWireMessage(message.payload)) {
        this.messageEmitter.emit(message.payload);
      }
      return;
    }
  }

  markReady(generation: number): void {
    const active = this.active;
    if (!active || active.generation !== generation || this.closed) return;
    active.ready = true;
    if (this.hasConnected) {
      this.reconnectEmitter.emit();
    } else {
      this.hasConnected = true;
    }
  }

  detach(generation: number, _exit?: ProcessExit): void {
    const active = this.active;
    if (!active || active.generation !== generation) return;
    this.active = undefined;
    if (!this.closed) this.disconnectEmitter.emit();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.active = undefined;
    this.disconnectEmitter.emit();
    this.messageEmitter.clear();
    this.disconnectEmitter.clear();
    this.reconnectEmitter.clear();
    this.readyEmitter.clear();
  }
}
