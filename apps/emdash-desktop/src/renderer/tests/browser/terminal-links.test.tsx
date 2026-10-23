import '@xterm/xterm/css/xterm.css';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import { getCellMetrics } from '@core/features/terminals/api/browser/pty/xterm-cell-metrics';
import { usePty } from '@core/features/terminals/browser/pty/use-pty';

const { openLink, showContextMenu, settings } = vi.hoisted(() => ({
  openLink: vi.fn(),
  showContextMenu: vi.fn(),
  settings: { autoCopyOnSelection: false },
}));

vi.mock('@core/features/workbench/api/browser/open-external-link', () => ({
  confirmOpenExternalLink: openLink,
}));
vi.mock('@core/primitives/desktop-host/browser/host-client', () => ({
  copyTextToClipboard: vi.fn(),
  getHostClient: async () => ({
    showTerminalContextMenu: showContextMenu,
    events: { subscribe: async () => () => {} },
  }),
}));
vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => settings }),
}));
vi.mock('@core/features/terminals/contributions/browser/pty/pane-sizing-context', () => ({
  usePaneSizingContext: () => null,
}));
vi.mock('@core/primitives/logging/browser/logger', () => ({
  log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function Harness({ pty }: { pty: FrontendPty }) {
  const ref = useRef<HTMLDivElement>(null);
  usePty({ pty, sessionId: pty.sessionId }, ref);
  return <div ref={ref} style={{ width: 800, height: 400 }} />;
}

describe('terminal links and copy through real xterm and usePty', () => {
  let pty: FrontendPty;
  let host: HTMLDivElement;
  let root: Root;
  let input: string[];

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    settings.autoCopyOnSelection = false;
    openLink.mockClear();
    showContextMenu.mockClear();
    for (const [name, value] of Object.entries({
      '--xterm-bg': '#101010',
      '--xterm-fg': '#f0f0f0',
      '--xterm-cursor': '#f0f0f0',
      '--xterm-cursor-accent': '#101010',
      '--xterm-selection-bg': '#335577',
      '--xterm-selection-fg': '#ffffff',
    })) {
      document.documentElement.style.setProperty(name, value);
    }
    input = [];
    pty = new FrontendPty('terminal-links', undefined, undefined, undefined, {
      connect: () => () => {},
      sendInput: (data) => input.push(data),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness pty={pty} />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    await frame();
    pty.dispose();
    host.remove();
    document.querySelector('[data-terminal-host="true"]')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function frame() {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }

  async function write(text: string) {
    await new Promise<void>((resolve) => pty.terminal.write(text, resolve));
    await frame();
  }

  function mouse(type: string, column: number, row = 1, options: MouseEventInit = {}) {
    const screen = pty.terminal.element!.querySelector('.xterm-screen')!;
    const rect = screen.getBoundingClientRect();
    const cell = getCellMetrics(pty.terminal)!;
    screen.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + (column - 0.5) * cell.width,
        clientY: rect.top + (row - 0.5) * cell.height,
        button: 0,
        detail: 1,
        buttons: type === 'mousedown' ? 1 : 0,
        ...options,
      })
    );
  }

  // A human click spans several frames, giving the TUI and xterm time to repaint.
  async function pause() {
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
  }

  const LINK = '\x1b]8;;https://example.com/target\x07Example link\x1b]8;;\x07';

  async function hoverLink(mouseMode = 1000) {
    await write(`\x1b[?${mouseMode}h\x1b[?1006h${LINK} ordinary`);
    mouse('mousemove', 3);
    await expect.poll(() => pty.getHoveredOscLink()).toBe('https://example.com/target');
    input.length = 0;
  }

  /** Link on row 5, a status line on row 1, and the cursor parked on row 7. */
  async function hoverLinkBelowStatus() {
    await write(`\x1b[?1000h\x1b[?1006hstatus 0\r\n\r\n\r\n\r\n${LINK} ordinary\r\n\r\n$ `);
    mouse('mousemove', 3, 5);
    await expect.poll(() => pty.getHoveredOscLink()).toBe('https://example.com/target');
    input.length = 0;
  }

  it.each([9, 1000, 1002, 1003])(
    'opens an OSC 8 link once without reporting mouse events in mode %s',
    async (mode) => {
      await hoverLink(mode);
      mouse('mousedown', 3);
      mouse('mouseup', 3);
      expect(openLink).toHaveBeenCalledExactlyOnceWith(
        'https://example.com/target',
        expect.any(Function)
      );
      expect(input).toEqual([]);
    }
  );

  it('preserves ordinary TUI mouse clicks', async () => {
    await hoverLink();
    mouse('mousemove', 18);
    mouse('mousedown', 18);
    mouse('mouseup', 18);
    expect(openLink).not.toHaveBeenCalled();
    expect(input).toEqual(['\x1b[<0;18;1M', '\x1b[<0;18;1m']);
  });

  it('cancels dragging away and back without reporting an orphaned drag', async () => {
    await hoverLink(1002);
    mouse('mousedown', 3);
    mouse('mousemove', 18, 1, { buttons: 1 });
    mouse('mousemove', 3, 1, { buttons: 1 });
    mouse('mouseup', 3);
    expect(openLink).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it.each(['outside', 'blur', 'unmount'] as const)(
    'cancels an intercepted click on %s and allows the next click',
    async (cancel) => {
      await hoverLink();
      mouse('mousedown', 3);
      if (cancel === 'outside') {
        document.body.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
      } else if (cancel === 'blur') {
        window.dispatchEvent(new Event('blur'));
        mouse('mouseup', 3);
      } else {
        pty.unmount();
        pty.mount(host.firstElementChild as HTMLElement);
        await frame();
        mouse('mouseup', 3);
      }
      expect(openLink).not.toHaveBeenCalled();
      mouse('mousemove', 18);
      mouse('mousemove', 3);
      mouse('mousedown', 3);
      mouse('mouseup', 3);
      expect(openLink).toHaveBeenCalledTimes(1);
    }
  );

  // In each case below the release is lost and the window keeps focus.
  it('releases the pointer when a lost release shows as a move without a button', async () => {
    await hoverLink(1003);
    mouse('mousedown', 3);
    mouse('mousemove', 18);
    expect(input).toEqual(['\x1b[<35;18;1M']);
    input.length = 0;
    mouse('mousedown', 18);
    mouse('mouseup', 18);
    expect(input).toEqual(['\x1b[<0;18;1M', '\x1b[<0;18;1m']);
    expect(openLink).not.toHaveBeenCalled();
  });

  it('lets a click elsewhere through after a lost release', async () => {
    await hoverLink();
    mouse('mousedown', 3);
    const button = document.body.appendChild(document.createElement('button'));
    const released = vi.fn();
    button.addEventListener('mouseup', released);
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0, buttons: 1 }));
    button.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    button.remove();
    expect(released).toHaveBeenCalledOnce();
    expect(openLink).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it('handles a new press on the link after a lost release as a fresh click', async () => {
    await hoverLink();
    mouse('mousedown', 3);
    mouse('mousedown', 3);
    mouse('mouseup', 3);
    expect(openLink).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
  });

  it('allows normal drag selection when mouse reporting is off', async () => {
    await hoverLink();
    await write('\x1b[?1000l');
    mouse('mousemove', 3);
    mouse('mousedown', 3);
    mouse('mousemove', 18, 1, { buttons: 1 });
    mouse('mouseup', 18);
    expect(pty.terminal.getSelection()).not.toBe('');
    expect(openLink).not.toHaveBeenCalled();
  });

  it('leaves ordinary OSC 8 activation to xterm when mouse reporting is off', async () => {
    await hoverLink();
    await write('\x1b[?1000l');
    mouse('mousemove', 3);
    mouse('mousedown', 3);
    mouse('mouseup', 3);
    expect(openLink).toHaveBeenCalledTimes(1);
    expect(input).toEqual([]);
  });

  it('preserves forced selection while the TUI reports mouse events', async () => {
    await hoverLink();
    pty.terminal.options.macOptionClickForcesSelection = true;
    const modifier = /Mac/.test(navigator.platform) ? { altKey: true } : { shiftKey: true };
    mouse('mousedown', 3, 1, modifier);
    mouse('mousemove', 18, 1, { ...modifier, buttons: 1 });
    mouse('mouseup', 18, 1, modifier);
    expect(pty.terminal.getSelection()).not.toBe('');
    expect(openLink).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it('opens once on a delayed click that focuses the terminal', async () => {
    await hoverLink();
    pty.terminal.blur();
    expect(document.activeElement).not.toBe(pty.terminal.textarea);
    // Focusing repaints the cursor row, which holds the link.
    mouse('mousedown', 3);
    await pause();
    mouse('mouseup', 3);
    expect(openLink).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
  });

  it.each([
    ['the link row', `\x1b7\x1b[5;1H${LINK} ordinary\x1b8`],
    ['the top row', '\x1b7\x1b[1;1Hstatus 1\x1b8'],
    ['a row above the link', '\x1b7\x1b[3;1Hprogress\x1b8'],
  ])('opens once when the TUI repaints %s during a click', async (_, repaint) => {
    await hoverLinkBelowStatus();
    mouse('mousedown', 3, 5);
    await write(repaint);
    await pause();
    mouse('mouseup', 3, 5);
    expect(openLink).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
  });

  it.each([
    [
      'destination',
      `\x1b7\x1b[5;1H\x1b]8;;https://example.com/other\x07Example link\x1b]8;;\x07\x1b8`,
      'https://example.com/other',
    ],
    ['position', `\x1b7\x1b[5;1H  ${LINK}\x1b[K\x1b8`, 'https://example.com/target'],
  ])('cancels a click when the TUI changes the link %s', async (_, repaint, hovered) => {
    await hoverLinkBelowStatus();
    mouse('mousedown', 3, 5);
    await write(repaint);
    expect(pty.getHoveredOscLink()).toBe(hovered);
    mouse('mouseup', 3, 5);
    expect(openLink).not.toHaveBeenCalled();
    expect(input).toEqual([]);
  });

  it.each([0, 2])('opens once when clicked %i frames after remounting', async (frames) => {
    await hoverLink();
    pty.unmount();
    pty.mount(host.firstElementChild as HTMLElement);
    for (let i = 0; i < frames; i += 1) await frame();
    mouse('mousedown', 3);
    mouse('mouseup', 3);
    expect(openLink).toHaveBeenCalledOnce();
    expect(input).toEqual([]);
  });

  it('either opens or reports, never both, for clicks around the edges of a link', async () => {
    await hoverLink();
    const screen = pty.terminal.element!.querySelector('.xterm-screen')!;
    const rect = screen.getBoundingClientRect();
    const cell = getCellMetrics(pty.terminal)!;
    const [top, bottom] = [Math.round(rect.top), Math.round(rect.top + cell.height)];
    const [left, right] = [Math.round(rect.left), Math.round(rect.left + 12 * cell.width)];
    const outcomes = new Set<string>();
    for (const y of [top - 1, top, bottom - 1, bottom, bottom + 1]) {
      for (let x = left - 2; x <= right + 2; x += 1) {
        openLink.mockClear();
        input.length = 0;
        const target = document.elementFromPoint(x, y)!;
        for (const type of ['mousemove', 'mousedown', 'mouseup']) {
          target.dispatchEvent(
            new MouseEvent(type, {
              bubbles: true,
              cancelable: true,
              clientX: x,
              clientY: y,
              button: 0,
              detail: 1,
              buttons: type === 'mousedown' ? 1 : 0,
            })
          );
        }
        const at = `click at (${x}, ${y})`;
        if (openLink.mock.calls.length > 0) {
          // Like xterm's linkifier, the terminal padding is never part of a link.
          expect(screen.contains(target), at).toBe(true);
          expect(openLink, at).toHaveBeenCalledOnce();
          expect(input, at).toEqual([]);
          outcomes.add('opened');
        } else {
          expect(input, at).toEqual([expect.stringMatching(/M$/), expect.stringMatching(/m$/)]);
          outcomes.add('reported');
        }
      }
    }
    expect([...outcomes].sort()).toEqual(['opened', 'reported']);
  });

  it.each([
    ['an OSC 8 link', `${LINK} ordinary text here`],
    ['a plain URL', 'https://example.com/plain ordinary text here'],
  ])('ends xterm selection after activating %s with reporting off', async (_, text) => {
    await write(text);
    mouse('mousemove', 3);
    await frame();
    mouse('mousedown', 3);
    mouse('mouseup', 3);
    expect(openLink).toHaveBeenCalledOnce();
    // Moving without a button held must not keep extending a selection.
    mouse('mousemove', 30);
    expect(pty.terminal.getSelection()).toBe('');
  });

  it('sends the TUI a complete click when xterm activates a plain URL', async () => {
    await write('\x1b[?1000h\x1b[?1006hhttps://example.com/plain ordinary');
    mouse('mousemove', 3);
    await frame();
    input.length = 0;
    mouse('mousedown', 3);
    mouse('mouseup', 3);
    expect(input).toEqual(['\x1b[<0;3;1M', '\x1b[<0;3;1m']);
  });

  function copy() {
    pty.terminal.textarea!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'c',
        code: 'KeyC',
        bubbles: true,
        cancelable: true,
        ...(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true, shiftKey: true }),
      })
    );
  }

  it.each([
    'https://example.com/\r\nhttps://other.example/',
    'https://example.com/path\r\nDone',
    'https://example.com/redirect?next=\r\nhttps://example.com/target',
  ])('preserves hard newlines in keyboard and context-menu copy: %s', async (text) => {
    await write(text);
    pty.terminal.selectAll();
    const selection = pty.terminal.getSelection();
    expect(selection).toContain('\n');
    copy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(selection);
    mouse('contextmenu', 3);
    await expect.poll(() => showContextMenu.mock.calls[0]?.[0].selectionText).toBe(selection);
  });

  it('preserves hard newlines in automatic selection copy', async () => {
    window.dispatchEvent(
      new CustomEvent('terminal-auto-copy-changed', { detail: { autoCopyOnSelection: true } })
    );
    await write('https://example.com/\r\nhttps://other.example/');
    pty.terminal.selectAll();
    await expect
      .poll(() => vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0])
      .toBe(pty.terminal.getSelection());
  });

  it('copies a soft-wrapped URL from selection and from its continuation row', async () => {
    pty.terminal.resize(24, 10);
    const url = 'https://example.com/longpath/to/resource';
    await write(url);
    pty.terminal.select(0, 0, url.length);
    copy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
    mouse('contextmenu', 2, 2);
    await expect.poll(() => showContextMenu.mock.calls[0]?.[0].linkText).toBe(url);
  });

  it('copies the OSC 8 destination of a label spanning hard lines', async () => {
    await write('\x1b]8;;https://example.com/full-destination\x07Friendly\r\nlabel\x1b]8;;\x07');
    mouse('mousemove', 2, 2);
    mouse('contextmenu', 2, 2);
    await expect
      .poll(() => showContextMenu.mock.calls[0]?.[0].linkText)
      .toBe('https://example.com/full-destination');
  });

  it('resolves a URL after resizing reflows its terminal rows', async () => {
    const url = 'https://example.com/longpath/to/resource';
    // xterm only reflows completed lines, not the active cursor line.
    await write(`${url}\r\n`);
    pty.terminal.resize(20, 10);
    await frame();
    pty.terminal.select(0, 0, url.length);
    copy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(url);
    mouse('contextmenu', 2, 2);
    await expect.poll(() => showContextMenu.mock.calls[0]?.[0].linkText).toBe(url);
  });

  async function contextLinks(...cells: Array<[column: number, row: number]>) {
    for (const [column, row] of cells) mouse('contextmenu', column, row);
    await expect.poll(() => showContextMenu.mock.calls.length).toBe(cells.length);
    return showContextMenu.mock.calls.map(([request]) => request.linkText);
  }

  it('copies a soft-wrapped URL whose wide character left wrap padding', async () => {
    pty.terminal.resize(24, 10);
    const url = 'https://example.com/abc界面tail';
    await write(url);
    // The wide character did not fit in column 24, leaving an empty cell before the wrap.
    const firstRow = pty.terminal.buffer.active.getLine(0);
    expect(firstRow?.translateToString(false)).toBe('https://example.com/abc ');
    expect(firstRow?.translateToString(true)).toBe('https://example.com/abc');
    expect(pty.terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);
    expect(await contextLinks([3, 1], [5, 2])).toEqual([url, url]);
  });

  it('ends a soft-wrapped URL at a printed space on the wrap boundary', async () => {
    pty.terminal.resize(24, 10);
    await write('https://example.com/abc started');
    expect(pty.terminal.buffer.active.getLine(0)?.translateToString(true)).toBe(
      'https://example.com/abc '
    );
    expect(pty.terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);
    expect(await contextLinks([3, 1], [2, 2])).toEqual(['https://example.com/abc', null]);
  });

  it('copies a short URL that follows thousands of characters on its logical line', async () => {
    // Narrow, so the URL stays inside the test browser's 414px viewport.
    pty.terminal.resize(40, 25);
    await write(`${'x'.repeat(4160)} see https://example.com/short ok`);
    const buffer = pty.terminal.buffer.active;
    // 4160 + ' see '.length puts the URL on buffer row 105 at columns 6-30.
    expect(buffer.getLine(104)?.translateToString(true)).toBe(' see https://example.com/short ok');
    expect(buffer.getLine(104)?.isWrapped).toBe(true);
    expect(await contextLinks([10, 105 - buffer.viewportY])).toEqual(['https://example.com/short']);
  });

  it('copies an IPv6 URL with its closing bracket', async () => {
    await write('Listening on http://[::1] now');
    expect(await contextLinks([16, 1])).toEqual(['http://[::1]']);
  });
});
