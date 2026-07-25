import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function getPtyModule() {
  return import('@renderer/lib/pty/pty');
}

// Solid red 12x6 block: raster attributes 1;1;12;6, one colour register, one sixel band.
const RED_BLOCK_SIXEL = '\x1bP0;1;0q"1;1;12;6#0;2;100;0;0#0~~~~~~~~~~~~\x1b\\';

function imageLayer(): HTMLCanvasElement | null {
  return document.querySelector<HTMLCanvasElement>('canvas.xterm-image-layer');
}

describe('FrontendPty inline images', () => {
  beforeEach(() => {
    vi.stubGlobal('electronAPI', {
      eventOn: vi.fn(() => () => {}),
      eventSend: vi.fn(),
      invoke: vi.fn(() => Promise.resolve({ success: true, data: null })),
    });

    document.documentElement.style.setProperty('--xterm-bg', '#101010');
    document.documentElement.style.setProperty('--xterm-fg', '#f0f0f0');
    document.documentElement.style.setProperty('--xterm-cursor', '#f0f0f0');
    document.documentElement.style.setProperty('--xterm-cursor-accent', '#101010');
    document.documentElement.style.setProperty('--xterm-selection-bg', '#335577');
    document.documentElement.style.setProperty('--xterm-selection-fg', '#ffffff');
  });

  afterEach(async () => {
    const { disposeAllPtys } = await getPtyModule();
    disposeAllPtys();
    document.querySelector('[data-terminal-host="true"]')?.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('paints a SIXEL image onto the terminal instead of dropping it', async () => {
    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty('image-session');

    expect(imageLayer()).toBeNull();

    frontendPty.terminal.write(RED_BLOCK_SIXEL);

    await expect.poll(() => imageLayer()).not.toBeNull();
    const layer = imageLayer();
    if (!layer) throw new Error('image layer missing');
    const ctx = layer.getContext('2d');
    if (!ctx) throw new Error('image layer has no 2d context');

    await expect.poll(() => ctx.getImageData(2, 2, 1, 1).data[3]).toBeGreaterThan(0);
    const [r, g, b] = ctx.getImageData(2, 2, 1, 1).data;
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(60);
    expect(b).toBeLessThan(60);
  });

  it('advertises SIXEL support in the primary device attributes reply', async () => {
    const { FrontendPty } = await getPtyModule();
    const frontendPty = new FrontendPty('da1-session');

    const replies: string[] = [];
    frontendPty.terminal.onData((data) => replies.push(data));
    frontendPty.terminal.write('\x1b[c');

    // Parameter 4 is what tmux and CLI tools look for to decide that an image
    // protocol is usable.
    await expect.poll(() => replies.join('')).toContain('\x1b[?62;4;');
  });
});
