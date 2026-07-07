import { Emitter, type Unsubscribe } from '@emdash/shared';
import { describe, expect, it, vi } from 'vitest';
import { processTransport } from './transport';
import type { ManagedProcess, ManagedProcessExit, StdioStream } from './types';

describe('processTransport', () => {
  it('maps managed process messages to a wire transport', () => {
    const process = new FakeManagedProcess();
    const transport = processTransport(process);
    const messages: unknown[] = [];
    const disconnect = vi.fn();

    transport.onMessage((message) => messages.push(message));
    transport.onDisconnect(disconnect);
    transport.post({ kind: 'hello', protocol: 1 });
    process.message({ kind: 'not-wire' });
    process.message({ kind: 'hello', protocol: 1 });
    process.exit({ code: 0, willRestart: false });

    expect(process.sent).toEqual([{ kind: 'hello', protocol: 1 }]);
    expect(messages).toEqual([{ kind: 'hello', protocol: 1 }]);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});

class FakeManagedProcess implements ManagedProcess {
  readonly pid = 1;
  readonly sent: unknown[] = [];
  private readonly messageEmitter = new Emitter<unknown>();
  private readonly exitEmitter = new Emitter<ManagedProcessExit>();

  send(message: unknown): void {
    this.sent.push(message);
  }

  onMessage(cb: (message: unknown) => void): Unsubscribe {
    return this.messageEmitter.subscribe(cb);
  }

  onExit(cb: (exit: ManagedProcessExit) => void): Unsubscribe {
    return this.exitEmitter.subscribe(cb);
  }

  onStdio(_cb: (stream: StdioStream, chunk: string) => void): Unsubscribe {
    return () => {};
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }

  message(message: unknown): void {
    this.messageEmitter.emit(message);
  }

  exit(exit: ManagedProcessExit): void {
    this.exitEmitter.emit(exit);
  }
}
