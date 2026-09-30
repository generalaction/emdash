import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { createXtermLogSink } from '@core/features/terminals/api/browser/pty/xterm-log-sink';

describe('xterm snapshot replay', () => {
  it('answers outstanding queries captured before the first subscription', async () => {
    const terminal = new Terminal();
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));
    try {
      createXtermLogSink(terminal).reset({
        baseOffset: 0,
        text: '\x1b[>c\x1b[6n',
        truncated: false,
      });
      await new Promise<void>((resolve) => terminal.write('', resolve));
      expect(replies).toEqual(['\x1b[>0;276;0c', '\x1b[1;1R']);
    } finally {
      terminal.dispose();
    }
  });

  it('does not change the terminal read-only setting', async () => {
    const terminal = new Terminal({ disableStdin: true });
    const replies: string[] = [];
    terminal.onData((data) => replies.push(data));
    try {
      const sink = createXtermLogSink(terminal);
      sink.reset({ baseOffset: 0, text: 'new\x1b[>c', truncated: false });
      sink.append('done\x1b[c');
      await expect
        .poll(() => terminal.buffer.active.getLine(0)?.translateToString(true))
        .toBe('newdone');
      expect(replies).toEqual([]);
      expect(terminal.options.disableStdin).toBe(true);
      terminal.options.disableStdin = false;
      sink.append('\x1b[c');
      await expect.poll(() => replies).toEqual(['\x1b[?1;2c']);
    } finally {
      terminal.dispose();
    }
  });
});
