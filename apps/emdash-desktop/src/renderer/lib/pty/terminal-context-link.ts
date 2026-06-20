import type { ILink, Terminal } from '@xterm/xterm';
import { findFileLinks, type BufferLike } from './file-link-detection';
import { getCellMetrics } from './xterm-cell-metrics';

const URL_PATTERN = /https?:\/\/[^\s"'<>`]+/gi;

export function getTerminalContextLink(terminal: Terminal, event: MouseEvent): string | null {
  const cell = getCellMetrics(terminal);
  const element = (terminal as unknown as { element?: HTMLElement }).element;
  if (!cell || !element) return null;

  const rect = element.getBoundingClientRect();
  const row = Math.floor((event.clientY - rect.top) / cell.height);
  const column = Math.floor((event.clientX - rect.left) / cell.width) + 1;
  if (row < 0 || row >= terminal.rows || column < 1 || column > terminal.cols) return null;

  return getTerminalLinkAtBufferCell(
    terminal.buffer.active,
    terminal.buffer.active.viewportY + row + 1,
    column
  );
}

export function getTerminalLinkAtBufferCell(
  buffer: BufferLike,
  bufferLineNumber: number,
  column: number
): string | null {
  const fileLink = findFileLinks(buffer, bufferLineNumber).find((link) =>
    rangeContainsColumn(link.range, bufferLineNumber, column)
  );
  if (fileLink) return fileLink.text;

  const line = buffer.getLine(bufferLineNumber - 1)?.translateToString(true);
  if (!line) return null;
  for (const match of line.matchAll(URL_PATTERN)) {
    const text = trimLinkText(match[0]);
    const start = (match.index ?? 0) + 1;
    const end = start + text.length - 1;
    if (column >= start && column <= end) return text;
  }
  return null;
}

function rangeContainsColumn(
  range: ILink['range'],
  bufferLineNumber: number,
  column: number
): boolean {
  if (bufferLineNumber < range.start.y || bufferLineNumber > range.end.y) return false;
  const startColumn = bufferLineNumber === range.start.y ? range.start.x : 1;
  const endColumn = bufferLineNumber === range.end.y ? range.end.x : Number.POSITIVE_INFINITY;
  return column >= startColumn && column <= endColumn;
}

function trimLinkText(text: string): string {
  return text.replace(/[),.;:!?]+$/, '');
}
