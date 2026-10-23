import type { ILink, Terminal } from '@xterm/xterm';
import { getCellMetrics } from '@core/features/terminals/api/browser/pty/xterm-cell-metrics';
import { findFileLinks, type BufferLike } from './file-link-detection';
import { findUrlLinks } from './url-link-detection';

export function getTerminalContextLink(terminal: Terminal, event: MouseEvent): string | null {
  const position = getTerminalBufferCell(terminal, event);
  if (!position) return null;
  return getTerminalLinkAtBufferCell(terminal.buffer.active, position.y, position.x);
}

export function isTerminalLinkAtMouseEvent(
  terminal: Terminal,
  event: MouseEvent,
  range: ILink['range']
): boolean {
  const position = getTerminalBufferCell(terminal, event);
  return position !== null && rangeContainsColumn(range, position.y, position.x);
}

function getTerminalBufferCell(
  terminal: Terminal,
  event: MouseEvent
): ILink['range']['start'] | null {
  const cell = getCellMetrics(terminal);
  const screen = terminal.element?.querySelector('.xterm-screen');
  // xterm's linkifier only listens on the screen, which excludes the terminal padding.
  if (!cell || !screen || !(event.target instanceof Node) || !screen.contains(event.target)) {
    return null;
  }

  // Mirror xterm's getCoords so hit tests agree with its linkifier on cell edges.
  const rect = screen.getBoundingClientRect();
  const column = clamp(Math.ceil((event.clientX - rect.left) / cell.width), 1, terminal.cols);
  const row = clamp(Math.ceil((event.clientY - rect.top) / cell.height), 1, terminal.rows);
  return { x: column, y: terminal.buffer.active.viewportY + row };
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

  return (
    findUrlLinks(buffer, bufferLineNumber).find((link) =>
      rangeContainsColumn(link.range, bufferLineNumber, column)
    )?.text ?? null
  );
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
