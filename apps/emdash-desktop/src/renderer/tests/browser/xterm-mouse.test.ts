import { Terminal, type ITerminalOptions } from '@xterm/xterm';
import { afterEach, describe, expect, it } from 'vitest';

function waitForWrite(term: Terminal, data: string): Promise<void> {
  return new Promise((resolve) => term.write(data, resolve));
}

function createTerminal(options: ITerminalOptions = {}): {
  container: HTMLDivElement;
  term: Terminal;
} {
  const container = document.createElement('div');
  Object.assign(container.style, {
    position: 'fixed',
    left: '0px',
    top: '0px',
    width: '800px',
    height: '400px',
  });
  document.body.appendChild(container);

  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true, ...options });
  term.open(container);
  return { container, term };
}

function dispatchMouse(target: Element, type: string, init?: MouseEventInit): void {
  target.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
      button: 0,
      buttons: 1,
      ...init,
    })
  );
}

function dispatchWheel(target: Element, init?: WheelEventInit): void {
  target.dispatchEvent(
    new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: 20,
      clientY: 20,
      deltaY: -120,
      ...init,
    })
  );
}

describe('xterm mouse reporting', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each([
    ['default options', {}],
    ['ConPTY mode', { windowsPty: { backend: 'conpty' } } satisfies ITerminalOptions],
  ])('emits click and wheel reports with %s', async (_label, options) => {
    const { container, term } = createTerminal(options);
    const data: string[] = [];
    const binary: string[] = [];
    term.onData((chunk) => data.push(chunk));
    term.onBinary((chunk) => binary.push(chunk));

    await waitForWrite(term, '\x1b[?1000h\x1b[?1006h');

    const screen = container.querySelector('.xterm-screen');
    expect(screen).not.toBeNull();

    dispatchMouse(screen!, 'mousedown');
    dispatchMouse(screen!, 'mouseup', { buttons: 0 });
    dispatchWheel(screen!);

    const emitted = [...data, ...binary].join('');
    expect(emitted).toContain('\x1b[<0;');
    expect(emitted).toContain('\x1b[<64;');
  });

  it('responds to OpenTUI private mode capability queries', async () => {
    const { term } = createTerminal();
    const data: string[] = [];
    term.onData((chunk) => data.push(chunk));

    // OpenTUI asks these before completing terminal setup for apps like opencode.
    await waitForWrite(term, '\x1b[?1016$p\x1b[?2027$p\x1b[?2031$p\x1b[?1004$p\x1b[?2004$p');

    expect(data.join('')).toBe(
      '\x1b[?1016;2$y\x1b[?2027;0$y\x1b[?2031;0$y\x1b[?1004;2$y\x1b[?2004;2$y'
    );
  });
});
