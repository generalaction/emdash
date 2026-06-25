import { describe, expect, it, vi } from 'vitest';
import {
  captureTerminalScrollViewport,
  focusTerminalPreservingScroll,
  restoreTerminalScrollViewport,
} from '@renderer/lib/pty/terminal-scroll-viewport';

function makeTerminal(buffer: { type: 'normal' | 'alternate'; baseY: number; viewportY: number }) {
  return {
    buffer: {
      active: buffer,
    },
    focus: vi.fn(() => {
      buffer.viewportY = 0;
    }),
    scrollToLine: vi.fn((line: number) => {
      buffer.viewportY = Math.max(0, Math.min(line, buffer.baseY));
    }),
  };
}

describe('terminal scroll viewport preservation', () => {
  it('keeps terminals pinned to the bottom across base changes', () => {
    const buffer = { type: 'normal' as const, baseY: 100, viewportY: 100 };
    const terminal = makeTerminal(buffer);
    const snapshot = captureTerminalScrollViewport(terminal);

    buffer.baseY = 120;
    buffer.viewportY = 0;

    restoreTerminalScrollViewport(terminal, snapshot);

    expect(terminal.scrollToLine).toHaveBeenCalledWith(120);
    expect(buffer.viewportY).toBe(120);
  });

  it('preserves distance from the bottom when the user is scrolled up', () => {
    const buffer = { type: 'normal' as const, baseY: 100, viewportY: 80 };
    const terminal = makeTerminal(buffer);
    const snapshot = captureTerminalScrollViewport(terminal);

    buffer.baseY = 130;
    buffer.viewportY = 0;

    restoreTerminalScrollViewport(terminal, snapshot);

    expect(terminal.scrollToLine).toHaveBeenCalledWith(110);
    expect(buffer.viewportY).toBe(110);
  });

  it('preserves scroll around focus', () => {
    const buffer = { type: 'normal' as const, baseY: 100, viewportY: 80 };
    const terminal = makeTerminal(buffer);

    focusTerminalPreservingScroll(terminal);

    expect(terminal.focus).toHaveBeenCalledOnce();
    expect(terminal.scrollToLine).toHaveBeenCalledWith(80);
    expect(buffer.viewportY).toBe(80);
  });

  it('does not restore after switching terminal buffers', () => {
    const buffer: { type: 'normal' | 'alternate'; baseY: number; viewportY: number } = {
      type: 'normal',
      baseY: 100,
      viewportY: 80,
    };
    const terminal = makeTerminal(buffer);
    const snapshot = captureTerminalScrollViewport(terminal);

    buffer.type = 'alternate';
    buffer.viewportY = 0;

    restoreTerminalScrollViewport(terminal, snapshot);

    expect(terminal.scrollToLine).not.toHaveBeenCalled();
    expect(buffer.viewportY).toBe(0);
  });
});
