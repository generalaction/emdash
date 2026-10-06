import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty, TERMINAL_PADDING_PX } from '@core/features/terminals/api/browser/pty/pty';
import { computeGridDimensions } from '@core/features/terminals/api/browser/pty/pty-dimensions';
import { createPaneDimensionSink } from '@core/primitives/workbench-shell/browser/tabs/pane-dimension-provider';
import { usePtyPaneResize, type PtyPaneResizeControls } from './use-pty-pane-resize';

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let pty: FrontendPty | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  pty?.dispose();
  root = null;
  container = null;
  pty = null;
});

function renderController(sessionIds: string[], width: number, height: number) {
  const sink = createPaneDimensionSink();
  sink.setDimensions(width, height);
  let controls: PtyPaneResizeControls | null = null;
  function Probe() {
    controls = usePtyPaneResize(sessionIds, sink);
    return null;
  }
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(createElement(Probe)));
  return controls!;
}

describe('usePtyPaneResize', () => {
  // A new controller (e.g. after switching back to a task) must not resize a live
  // terminal from seed metrics: the PTY would not follow, and the TUI keeps painting
  // against a grid that reflowed underneath it (#2985).
  it('publishes no dims and resizes nothing before a terminal calibrates', () => {
    const resize = vi.fn();
    pty = new FrontendPty('pane-resize-uncalibrated', undefined, undefined, undefined, {
      connect: () => () => {},
      resize,
    });
    pty.terminal.resize(100, 30);

    const controls = renderController([pty.sessionId], 1120, 565);

    expect(controls.getCurrentDimensions()).toBeNull();
    expect(controls.controllerDims.get()).toBeNull();
    expect(resize).not.toHaveBeenCalled();
    expect(pty.terminal.cols).toBe(100);
    expect(pty.terminal.rows).toBe(30);
  });

  it('resizes the terminal and its PTY together on first calibration', () => {
    const resize = vi.fn();
    pty = new FrontendPty('pane-resize-calibrated', undefined, undefined, undefined, {
      connect: () => () => {},
      resize,
    });
    pty.terminal.resize(100, 30);

    const controls = renderController([pty.sessionId], 1120, 565);
    act(() => controls.calibrateCell(8, 16));

    const expected = computeGridDimensions({
      widthPx: 1120,
      heightPx: 565,
      cellWidth: 8,
      cellHeight: 16,
      paddingPx: TERMINAL_PADDING_PX,
    });
    expect(controls.getCurrentDimensions()).toEqual(expected);
    expect(resize).toHaveBeenCalledWith(expected!.cols, expected!.rows);
    expect(pty.terminal.cols).toBe(expected!.cols);
    expect(pty.terminal.rows).toBe(expected!.rows);
  });
});
