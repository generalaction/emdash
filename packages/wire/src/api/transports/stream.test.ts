import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import type { WireMessage } from '../protocol';
import { streamTransport } from './stream';

class FakeReadable extends EventEmitter {
  push(chunk: string): void {
    this.emit('data', chunk);
  }

  close(): void {
    this.emit('close');
  }
}

class FakeWritable {
  readonly chunks: string[] = [];

  write(chunk: string): void {
    this.chunks.push(chunk);
  }
}

describe('streamTransport', () => {
  it('parses messages split across chunks and multiple messages in one chunk', () => {
    const input = new FakeReadable();
    const output = new FakeWritable();
    const transport = streamTransport(input, output);
    const messages: WireMessage[] = [];
    transport.onMessage((message) => messages.push(message));

    const first = JSON.stringify({ kind: 'hello', protocol: 1 });
    const second = JSON.stringify({ kind: 'detach', topic: 'topic' });
    input.push(`${first.slice(0, 5)}`);
    input.push(`${first.slice(5)}\nnot-json\n${second}\n`);

    expect(messages).toEqual([
      { kind: 'hello', protocol: 1 },
      { kind: 'detach', topic: 'topic' },
    ]);
  });

  it('writes ndjson frames and emits disconnects', () => {
    const input = new FakeReadable();
    const output = new FakeWritable();
    const transport = streamTransport(input, output);
    let disconnected = false;
    transport.onDisconnect(() => {
      disconnected = true;
    });

    transport.post({ kind: 'detach', topic: 'topic' });
    input.close();

    expect(output.chunks).toEqual([`${JSON.stringify({ kind: 'detach', topic: 'topic' })}\n`]);
    expect(disconnected).toBe(true);
  });
});
