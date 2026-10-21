import { describe, expect, it } from 'vitest';
import { FakePtySpawner } from '#services/pty/testing';
import { PtyRegistry } from './pty-registry';
import { TerminalCapabilityResponder } from './terminal-capability-responder';

describe('TerminalCapabilityResponder', () => {
  it.each(['\x1b[c', '\x1b[0c', '\x1b[000c', '\x9bc', '\x1b[;2c'])('answers DA1 %j', (query) => {
    const replies: string[] = [];
    const responder = new TerminalCapabilityResponder((reply) => replies.push(reply));
    expect(responder.push(`before${query}after`)).toBe('beforeafter');
    expect(replies).toEqual(['\x1b[?1;2c']);
  });

  it('handles every chunk boundary without emitting a query or duplicating a reply', () => {
    const output = 'hello\x1b[c\x1b[>0c\x1b[31mworld\x1b[0m';
    for (let split = 0; split <= output.length; split++) {
      const replies: string[] = [];
      const responder = new TerminalCapabilityResponder((reply) => replies.push(reply));
      expect(responder.push(output.slice(0, split)) + responder.push(output.slice(split))).toBe(
        'hello\x1b[31mworld\x1b[0m'
      );
      expect(replies).toEqual(['\x1b[?1;2c', '\x1b[>0;276;0c']);
    }
  });

  it.each([
    '\x1b[6n',
    '\x1b[>q',
    '\x1b[1c',
    '\x1b[>1c',
    '\x1b[?1;2c',
    '\x1b[31mred\x1b[0m',
    '\x1b]0;title[c\x07',
    '\x1bPpayload[>c\x1b\\',
    '\x1b_payload[c\x1b\\',
    '\x9dtitle[c\x9c',
    `\x1b[${'0'.repeat(100)}c`,
    '\x1b[\x18c',
  ])('preserves unrelated sequences and opaque string payloads: %j', (input) => {
    const replies: string[] = [];
    const responder = new TerminalCapabilityResponder((reply) => replies.push(reply));
    expect(
      input
        .split('')
        .map((char) => responder.push(char))
        .join('') + responder.finish()
    ).toBe(input);
    expect(replies).toEqual([]);
  });

  it('flushes incomplete output on exit', () => {
    const responder = new TerminalCapabilityResponder(() => {});
    expect(responder.push('text\x1b[>')).toBe('text');
    expect(responder.finish()).toBe('\x1b[>');
    expect(responder.finish()).toBe('');
  });

  it('answers before logging output and never changes user input', async () => {
    const spawner = new FakePtySpawner();
    const registry = new PtyRegistry(spawner);
    const session = await registry.create(
      'tmux',
      {
        invocation: { kind: 'argv', executable: '/bin/sh', argv: [] },
        cwd: '/tmp',
        env: {},
        cols: 80,
        rows: 24,
      },
      { tmux: true }
    );
    const process = spawner.processes[0]!;
    process.emitData('prompt\x1b[');
    process.emitData('>c');
    expect(process.writes).toEqual(['\x1b[>0;276;0c']);
    expect(session.output.snapshot().data.text).toBe('prompt');
    const input = 'paste\x1b[?1;2c\r';
    session.write(input);
    expect(process.writes.at(-1)).toBe(input);
    process.emitData('\x1b[');
    process.emitExit();
    expect(session.output.snapshot().data.text).toBe('prompt\x1b[');
    registry.killAll();
  });
});
