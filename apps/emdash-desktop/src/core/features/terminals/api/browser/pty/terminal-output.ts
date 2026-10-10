import type { PtySession } from '@core/features/terminals/api/browser/pty/pty-session';

const MAX_OUTPUT_LINES = 200;

type OutputBufferLine = {
  isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
};

type OutputBuffer = {
  length: number;
  getLine(index: number): OutputBufferLine | undefined;
};

export type OutputTerminal = {
  getSelection(): string;
  buffer: { active: OutputBuffer };
};

/**
 * Text a user would want to hand to an agent: the current selection when there
 * is one, otherwise the last lines of the buffer with soft-wrapped rows rejoined.
 */
export function readTerminalOutput(terminal: OutputTerminal, maxLines = MAX_OUTPUT_LINES): string {
  const selection = terminal.getSelection();
  if (selection.trim()) return selection.trimEnd();
  return readBufferTail(terminal.buffer.active, maxLines);
}

export function readBufferTail(buffer: OutputBuffer, maxLines: number): string {
  const lines: string[] = [];
  let row = buffer.length - 1;
  while (row >= 0 && lines.length < maxLines) {
    let start = row;
    while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
    let text = '';
    // Rows that continue onto a wrapped row are full width, so only the last
    // row of a logical line has padding to trim.
    for (let r = start; r <= row; r++)
      text += buffer.getLine(r)?.translateToString(r === row) ?? '';
    // Skip the empty rows below the cursor so they don't use up the budget.
    if (lines.length > 0 || text.trim()) lines.push(text);
    row = start - 1;
  }
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return lines.reverse().join('\n');
}

/** Connects the session if needed and waits for replayed output to land before reading. */
export async function readPtySessionOutput(session: PtySession): Promise<string> {
  await session.connect();
  const terminal = session.pty?.terminal;
  if (!terminal) return '';
  await new Promise<void>((resolve) => terminal.write('', resolve));
  return readTerminalOutput(terminal);
}
