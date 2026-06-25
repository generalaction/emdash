import type { Terminal } from '@xterm/xterm';

type TerminalBufferType = Terminal['buffer']['active']['type'];

type TerminalWithBuffer = {
  buffer: {
    active: {
      type: TerminalBufferType;
      baseY: number;
      viewportY: number;
    };
  };
};

type ScrollableTerminal = TerminalWithBuffer & {
  scrollToLine: (line: number) => void;
};

export interface TerminalScrollViewportSnapshot {
  bufferType: TerminalBufferType;
  distanceFromBottom: number;
}

export function captureTerminalScrollViewport(
  terminal: TerminalWithBuffer
): TerminalScrollViewportSnapshot {
  const buffer = terminal.buffer.active;
  return {
    bufferType: buffer.type,
    distanceFromBottom: Math.max(0, buffer.baseY - buffer.viewportY),
  };
}

export function restoreTerminalScrollViewport(
  terminal: ScrollableTerminal,
  snapshot: TerminalScrollViewportSnapshot
): void {
  const buffer = terminal.buffer.active;
  if (buffer.type !== snapshot.bufferType) return;

  const targetViewportY = Math.max(0, buffer.baseY - snapshot.distanceFromBottom);
  if (buffer.viewportY !== targetViewportY) {
    terminal.scrollToLine(targetViewportY);
  }
}
