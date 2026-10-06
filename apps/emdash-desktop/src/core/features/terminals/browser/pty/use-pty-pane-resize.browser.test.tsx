import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty, TERMINAL_PADDING_PX } from '@core/features/terminals/api/browser/pty/pty';
import { computeGridDimensions } from '@core/features/terminals/api/browser/pty/pty-dimensions';
import { createWorkspaceTerminalAttachments } from '@core/features/terminals/api/browser/terminal-attachments';
import { PaneSizingContextProvider } from '@core/features/terminals/contributions/browser/pty/pane-sizing-context';
import { PtyPane } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import type * as hostClientModule from '@core/primitives/desktop-host/browser/host-client';
import {
  createPaneDimensionSink,
  PaneDimensionProvider,
} from '@core/primitives/workbench-shell/browser/tabs/pane-dimension-provider';
import { usePtyPaneResize, type PtyPaneResizeControls } from './use-pty-pane-resize';

vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => ({}) }),
}));
vi.mock('@core/primitives/desktop-host/browser/host-client', async (importOriginal) => ({
  ...(await importOriginal<typeof hostClientModule>()),
  getHostClient: async () => ({ events: { subscribe: async () => () => {} } }),
}));

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

describe('PtyPane remount', () => {
  // Task switching unmounts the pane and later mounts the parked terminal under a
  // fresh, uncalibrated controller. The pane's dimension sink outlives the view and
  // the sizing provider commits before the terminal does, so the controller already
  // has pixel dimensions when the terminal mounts. That remount must not resize xterm
  // on its own.
  it('never resizes xterm without its PTY when the terminal is mounted again', async () => {
    const backend: Array<[number, number]> = [];
    pty = new FrontendPty('pane-resize-remount', undefined, undefined, undefined, {
      connect: () => () => {},
      resize: (cols, rows) => backend.push([cols, rows]),
    });
    const grid: Array<[number, number]> = [];
    pty.terminal.onResize(({ cols, rows }) => grid.push([cols, rows]));
    const sink = createPaneDimensionSink();
    const renderPane = (withTerminal: boolean) =>
      act(() =>
        root!.render(
          <div style={{ width: 800, height: 400 }}>
            <PaneDimensionProvider sink={sink}>
              <PaneSizingContextProvider sessionIds={[pty!.sessionId]}>
                {withTerminal ? (
                  <PtyPane
                    attachments={createWorkspaceTerminalAttachments('workspace-1')}
                    pty={pty!}
                    sessionId={pty!.sessionId}
                    workspaceId="workspace-1"
                  />
                ) : null}
              </PaneSizingContextProvider>
            </PaneDimensionProvider>
          </div>
        )
      );

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    renderPane(false);
    renderPane(true);
    await expect.poll(() => backend.length).toBeGreaterThan(0);
    const settled = [pty.terminal.cols, pty.terminal.rows];
    expect(backend.at(-1)).toEqual(settled);

    // Switch away, then back.
    act(() => root!.render(null));
    grid.length = 0;
    backend.length = 0;
    renderPane(false);
    renderPane(true);
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(grid).toEqual([]);
    expect([pty.terminal.cols, pty.terminal.rows]).toEqual(settled);
    for (const call of backend) expect(call).toEqual(settled);
  });
});
