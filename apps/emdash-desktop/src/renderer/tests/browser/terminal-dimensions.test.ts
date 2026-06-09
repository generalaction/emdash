/**
 * Browser-mode tests for measureDimensions().
 *
 * These run in a real Chromium process via Playwright so getComputedStyle
 * reflects genuine CSS layout — no stubs required for the DOM or CSSOM.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { measureDimensions } from '@renderer/lib/pty/pty-dimensions';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeContainer(width: string, height: string): HTMLDivElement {
  const el = document.createElement('div');
  el.style.position = 'absolute';
  el.style.width = width;
  el.style.height = height;
  document.body.appendChild(el);
  return el;
}

// Cell sizes used throughout the suite.  Chosen to give clean integer results.
const CW = 8; // cell width  (px)
const CH = 16; // cell height (px)

// ── Suite ─────────────────────────────────────────────────────────────────────

describe('measureDimensions', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    container?.remove();
  });

  // ── Null / guard conditions ────────────────────────────────────────────────

  it('returns null when cellWidth is 0', () => {
    container = makeContainer('800px', '400px');
    expect(measureDimensions(container, 0, CH)).toBeNull();
  });

  it('returns null when cellHeight is 0', () => {
    container = makeContainer('800px', '400px');
    expect(measureDimensions(container, CW, 0)).toBeNull();
  });

  it('returns null when computed height is 0', () => {
    // height: 0 is the height-chain failure mode (collapsed flex child).
    container = makeContainer('800px', '0px');
    expect(measureDimensions(container, CW, CH)).toBeNull();
  });

  it('returns null when container has no explicit size (auto / 0)', () => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // No width/height set — auto resolves to 0px for an absolutely-positioned div.
    container.style.position = 'absolute';
    expect(measureDimensions(container, CW, CH)).toBeNull();
  });

  // ── Normal calculation ─────────────────────────────────────────────────────

  it('computes cols and rows from a plain sized container', () => {
    container = makeContainer('800px', '400px');
    const dims = measureDimensions(container, CW, CH);
    expect(dims).toEqual({
      cols: Math.floor(800 / CW), // 100
      rows: Math.floor(400 / CH), // 25
    });
  });

  it('subtracts scrollbarWidth from available width', () => {
    container = makeContainer('800px', '400px');
    const SCROLLBAR = 15;
    const dims = measureDimensions(container, CW, CH, SCROLLBAR);
    expect(dims).toEqual({
      cols: Math.floor((800 - SCROLLBAR) / CW), // 98
      rows: Math.floor(400 / CH), // 25
    });
  });

  it('clamps cols to MINIMUM_COLS (2) when container is very narrow', () => {
    container = makeContainer('3px', '400px'); // 3 / 8 = 0 → clamp to 2
    const dims = measureDimensions(container, CW, CH);
    expect(dims).not.toBeNull();
    expect(dims!.cols).toBe(2);
  });

  it('clamps rows to MINIMUM_ROWS (1) when container is shorter than one cell', () => {
    container = makeContainer('800px', '10px'); // 10 / 16 = 0 → clamp to 1
    const dims = measureDimensions(container, CW, CH);
    expect(dims).not.toBeNull();
    expect(dims!.rows).toBe(1);
  });

  it('floors fractional cell width correctly', () => {
    // 800 / 8.4 = 95.23... → floor → 95
    container = makeContainer('800px', '400px');
    const dims = measureDimensions(container, 8.4, CH);
    expect(dims).not.toBeNull();
    expect(dims!.cols).toBe(Math.floor(800 / 8.4));
  });

  it('floors fractional cell height correctly', () => {
    // 400 / 16.5 = 24.24... → floor → 24
    container = makeContainer('800px', '400px');
    const dims = measureDimensions(container, CW, 16.5);
    expect(dims).not.toBeNull();
    expect(dims!.rows).toBe(Math.floor(400 / 16.5));
  });

  // ── Height-chain integration ───────────────────────────────────────────────
  // Validates the CSS fix in panel.tsx + pane-sizing-context.tsx:
  //   flex parent → flex child (flex:1) → PaneSizingProvider wrapper (flex:1 1 0%) → container
  // The container must receive real pixel height via CSS flex distribution.

  it('resolves height correctly inside a flex column chain', () => {
    const PARENT_H = 600;
    const TABS_H = 40;
    const TERMINAL_H = PARENT_H - TABS_H; // 560

    // Outer panel: flex column, fixed height
    const panel = document.createElement('div');
    panel.style.position = 'absolute';
    panel.style.width = '1200px';
    panel.style.height = `${PARENT_H}px`;
    panel.style.display = 'flex';
    panel.style.flexDirection = 'column';
    document.body.appendChild(panel);

    // Tabs row: shrink-0
    const tabs = document.createElement('div');
    tabs.style.flex = 'none';
    tabs.style.height = `${TABS_H}px`;
    panel.appendChild(tabs);

    // Terminal area: flex:1, flex container (the panel.tsx fix)
    const terminalArea = document.createElement('div');
    terminalArea.style.flex = '1 1 0%';
    terminalArea.style.minHeight = '0';
    terminalArea.style.display = 'flex';
    terminalArea.style.flexDirection = 'column';
    panel.appendChild(terminalArea);

    // PaneSizingProvider wrapper: flex:1 1 0% (the pane-sizing-context.tsx fix)
    container = document.createElement('div');
    container.style.flex = '1 1 0%';
    container.style.height = '100%';
    container.style.minHeight = '0';
    container.style.minWidth = '0';
    terminalArea.appendChild(container);

    const dims = measureDimensions(container, CW, CH);
    expect(dims).not.toBeNull();
    expect(dims!.rows).toBe(Math.floor(TERMINAL_H / CH)); // 35
    expect(dims!.cols).toBe(Math.floor(1200 / CW)); // 150

    panel.remove();
  });

  it('returns null when the flex chain is broken (non-flex parent)', () => {
    // Simulates the OLD bug: terminal-area div is not a flex container so
    // the wrapper's flex:1 has no effect and it collapses to auto height (0).
    const panel = document.createElement('div');
    panel.style.position = 'absolute';
    panel.style.width = '1200px';
    panel.style.height = '600px';
    // NOT a flex container ← this is the pre-fix state
    document.body.appendChild(panel);

    container = document.createElement('div');
    container.style.flex = '1 1 0%';
    container.style.minHeight = '0';
    panel.appendChild(container);

    // Without a flex parent, flex:1 is ignored and height resolves to 0.
    expect(measureDimensions(container, CW, CH)).toBeNull();

    panel.remove();
  });
});
