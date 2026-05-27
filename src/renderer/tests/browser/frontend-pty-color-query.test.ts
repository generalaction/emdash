import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ptyDataChannel } from '@shared/events/ptyEvents';

const sendInput = vi.fn(() => Promise.resolve());
let liveOutputHandler: ((data: string) => void) | null = null;

vi.mock('@renderer/lib/ipc', () => ({
  rpc: {
    app: {
      openExternal: vi.fn(() => Promise.resolve()),
    },
    pty: {
      subscribe: vi.fn(),
      unsubscribe: vi.fn(() => Promise.resolve()),
      sendInput,
    },
  },
  events: {
    on: vi.fn((channel: typeof ptyDataChannel, handler: (data: string) => void) => {
      if (channel === ptyDataChannel) liveOutputHandler = handler;
      return () => {
        liveOutputHandler = null;
      };
    }),
  },
}));

vi.mock('@renderer/utils/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

const OSC_11_QUERY = '\x1b]11;?\x1b\\';

async function waitForWriteQueue(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('FrontendPty color query handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveOutputHandler = null;
    document.documentElement.style.setProperty('--xterm-bg', '#102030');
    document.documentElement.style.setProperty('--xterm-fg', '#ffffff');
    document.documentElement.style.setProperty('--xterm-cursor', '#ffffff');
    document.documentElement.style.setProperty('--xterm-cursor-accent', '#000000');
    document.documentElement.style.setProperty('--xterm-selection-bg', '#335577');
    document.documentElement.style.setProperty('--xterm-selection-fg', '#ffffff');
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it('ignores historical OSC 11 color queries and replies to live ones', async () => {
    const { rpc } = await import('@renderer/lib/ipc');
    vi.mocked(rpc.pty.subscribe).mockResolvedValue({
      success: true,
      data: { buffer: OSC_11_QUERY },
    });

    const { FrontendPty } = await import('@renderer/lib/pty/pty');
    const pty = new FrontendPty('session-1');

    await pty.connect();
    await waitForWriteQueue();

    expect(sendInput).not.toHaveBeenCalled();
    expect(liveOutputHandler).toBeTypeOf('function');

    liveOutputHandler?.(OSC_11_QUERY);
    await waitForWriteQueue();

    expect(sendInput).toHaveBeenCalledTimes(1);
    expect(sendInput).toHaveBeenCalledWith('session-1', '\x1b]11;rgb:1010/2020/3030\x1b\\');

    pty.dispose();
  });
});
