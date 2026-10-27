import { PtySession } from '@emdash/core/services/pty/api';
import { Terminal } from '@xterm/xterm';
import { spawn } from 'node-pty';
import { describe, expect, it } from 'vitest';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';

describe('initial terminal snapshot', () => {
  it('answers a real process waiting on a query emitted before subscription', async () => {
    const terminal = new Terminal();
    const proc = spawn(
      process.execPath,
      [
        '-e',
        `
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdout.write('GOT_REPLY');
        process.exit(0);
      });
      process.stdout.write('\\x1b[6n');
      setTimeout(() => process.exit(1), 2000);
    `,
      ],
      {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
        env: { ...process.env },
      }
    );
    let output = '';
    let subscribed = false;
    const sink = createXtermLogSink(terminal);
    const exited = new Promise<number>((resolve) => {
      proc.onExit(({ exitCode }) => resolve(exitCode));
    });
    const queried = new Promise<void>((resolve) => {
      proc.onData((data) => {
        output += data;
        if (subscribed) sink.append(data);
        if (output.includes('\x1b[6n')) resolve();
      });
    });
    terminal.onData((data) => proc.write(data));
    try {
      await Promise.race([
        queried,
        exited.then(() => {
          throw new Error('Process exited before querying the terminal');
        }),
      ]);
      // Reproduce start-process -> attach-log, not the live append path.
      subscribed = true;
      sink.reset({ baseOffset: 0, text: output, truncated: false });
      expect(await exited).toBe(0);
      expect(output).toContain('GOT_REPLY');
    } finally {
      proc.kill();
      terminal.dispose();
    }
  });
});

describe('host DA handling with real xterm', () => {
  it.each([
    '\x1b\x1b[cHELLO',
    '\x1b[\x1b[cHELLO',
    '\x1b[31\x1b[cHELLO',
    '\x1b(\x1b[cHELLO',
    '\x1b\n[\x1b[cHELLO',
    '\x1b\x7f[\x1b[cHELLO',
    '\x1b[31\x9bcHELLO',
    `\x1b[${'0'.repeat(100)}\x1b[cHELLO`,
    '\x1b]0;title\x1b[cHELLO',
    '\x1b]0;title\x9bcHELLO',
    '\x1bPpayload\x1b[>cHELLO',
    '\x1b_payload\x1b[cHELLO',
  ])('preserves cancellation and display for %j at every chunk boundary', async (text) => {
    const baseline = new Terminal();
    const expectedReplies: string[] = [];
    const expectedTitles: string[] = [];
    baseline.onData((data) => expectedReplies.push(data));
    baseline.onTitleChange((title) => expectedTitles.push(title));
    await new Promise<void>((resolve) => baseline.write(text, resolve));
    try {
      for (let split = 0; split <= text.length; split++) {
        const terminal = new Terminal();
        const replies: string[] = [];
        const rendererReplies: string[] = [];
        const titles: string[] = [];
        let emit = (_chunk: string) => {};
        const session = new PtySession(
          'probe',
          {
            invocation: { kind: 'argv', executable: '/bin/sh', argv: [] },
            cwd: '/tmp',
            env: {},
            cols: 80,
            rows: 24,
          },
          {
            write: (data) => replies.push(data),
            resize() {},
            kill() {},
            onData: (handler) => {
              emit = handler;
            },
            onExit() {},
          },
          { tmux: true, onData: (data) => terminal.write(data) }
        );
        terminal.onData((data) => rendererReplies.push(data));
        terminal.onTitleChange((title) => titles.push(title));
        try {
          emit(text.slice(0, split));
          emit(text.slice(split));
          await new Promise<void>((resolve) => terminal.write('', resolve));
          expect(screen(terminal), `split ${split}`).toEqual(screen(baseline));
          expect(titles).toEqual(expectedTitles);
          expect(replies).toEqual(expectedReplies);
          expect(rendererReplies).toEqual([]);
        } finally {
          session.dispose();
          terminal.dispose();
        }
      }
    } finally {
      baseline.dispose();
    }
  });
});

function screen(terminal: Terminal): string[] {
  return Array.from(
    { length: terminal.rows },
    (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? ''
  );
}
