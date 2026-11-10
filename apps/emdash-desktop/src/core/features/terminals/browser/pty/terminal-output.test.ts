import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { readTerminalOutput } from '@core/features/terminals/api/browser/pty/terminal-output';

async function withTerminal(output: string, run: (terminal: Terminal) => void) {
  const terminal = new Terminal({ cols: 10, rows: 5, allowProposedApi: true });
  try {
    await new Promise<void>((resolve) => terminal.write(output, resolve));
    run(terminal);
  } finally {
    terminal.dispose();
  }
}

describe('readTerminalOutput', () => {
  it('rejoins soft-wrapped rows and drops the empty rows below the cursor', async () => {
    await withTerminal('$ echo\r\nabcdefghijklmnop\r\ndone', (terminal) => {
      expect(readTerminalOutput(terminal)).toBe('$ echo\nabcdefghijklmnop\ndone');
    });
  });

  it('keeps only the most recent logical lines', async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    await withTerminal(lines.join('\r\n'), (terminal) => {
      expect(readTerminalOutput(terminal, 3)).toBe('line 27\nline 28\nline 29');
    });
  });

  it('keeps spaces that fall exactly on a wrap boundary', async () => {
    await withTerminal('abcdefghi jkl', (terminal) => {
      expect(readTerminalOutput(terminal)).toBe('abcdefghi jkl');
    });
  });

  it('prefers the selection when there is one', () => {
    const terminal = {
      getSelection: () => 'picked text\n',
      buffer: { active: { length: 0, getLine: () => undefined } },
    };
    expect(readTerminalOutput(terminal)).toBe('picked text');
  });

  it('returns an empty string for a terminal with no output', async () => {
    await withTerminal('', (terminal) => {
      expect(readTerminalOutput(terminal)).toBe('');
    });
  });
});
