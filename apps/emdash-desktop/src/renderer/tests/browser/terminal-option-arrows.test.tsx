import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontendPty } from '@core/features/terminals/api/browser/pty/pty';
import { createWorkspaceTerminalAttachments } from '@core/features/terminals/api/browser/terminal-attachments';
import type { PtyPane as PtyPaneType } from '@core/features/terminals/contributions/browser/pty/pty-pane';
import type * as hostClientModule from '@core/primitives/desktop-host/browser/host-client';

vi.mock('@core/services/settings/api/client', () => ({
  getAppSettingsClient: async () => ({ get: async () => ({}) }),
}));
vi.mock('@core/primitives/desktop-host/browser/host-client', async (importOriginal) => ({
  ...(await importOriginal<typeof hostClientModule>()),
  getHostClient: async () => ({ events: { subscribe: async () => () => {} } }),
}));

let PtyPane: typeof PtyPaneType;

function Harness({
  pty,
  readOnly = false,
  inputContext,
}: {
  pty: FrontendPty;
  readOnly?: boolean;
  inputContext?: 'shell' | 'agent';
}) {
  return (
    <div style={{ width: 800, height: 400 }}>
      <PtyPane
        attachments={createWorkspaceTerminalAttachments('workspace-1')}
        pty={pty}
        sessionId={pty.sessionId}
        workspaceId="option-arrows-workspace"
        readOnly={readOnly}
        inputContext={inputContext}
      />
    </div>
  );
}

describe('macOS Option arrows through PtyPane and real xterm', () => {
  let root: Root;
  let host: HTMLDivElement;
  let pty: FrontendPty;
  let input: string[];

  beforeAll(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    ({ PtyPane } = await import('@core/features/terminals/contributions/browser/pty/pty-pane'));
  });

  afterAll(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  beforeEach(async () => {
    for (const [name, value] of Object.entries({
      '--xterm-bg': '#101010',
      '--xterm-fg': '#f0f0f0',
      '--xterm-cursor': '#f0f0f0',
      '--xterm-cursor-accent': '#101010',
      '--xterm-selection-bg': '#335577',
      '--xterm-selection-fg': '#ffffff',
    }))
      document.documentElement.style.setProperty(name, value);
    input = [];
    pty = new FrontendPty('option-arrows', undefined, undefined, undefined, {
      connect: () => () => {},
      sendInput: (data) => input.push(data),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness pty={pty} />));
    pty.terminal.focus();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    // Let xterm finish layout queued by reparenting before disposing its renderer.
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    pty.dispose();
    host.remove();
    document.querySelector('[data-terminal-host="true"]')?.remove();
  });

  function press(key: string, modifiers: Partial<KeyboardEventInit> = { altKey: true }) {
    const keyCodes: Record<string, number> = {
      ArrowLeft: 37,
      ArrowUp: 38,
      ArrowRight: 39,
      ArrowDown: 40,
    };
    const keyCode = keyCodes[key];
    for (const type of ['keydown', 'keyup']) {
      pty.terminal.textarea!.dispatchEvent(
        new KeyboardEvent(type, {
          key,
          code: key,
          keyCode,
          bubbles: true,
          cancelable: true,
          ...modifiers,
        })
      );
    }
  }

  it.each([false, true])(
    'maps all arrows exactly once with Option-as-Meta=%s',
    (macOptionIsMeta) => {
      pty.terminal.options.macOptionIsMeta = macOptionIsMeta;
      press('ArrowLeft');
      press('ArrowRight');
      press('ArrowUp');
      press('ArrowDown');
      expect(input).toEqual(['\x1bb', '\x1bf', '\x01', '\x05']);
    }
  );

  it.each([false, true])(
    'forwards all agent Option arrows exactly once with Option-as-Meta=%s',
    async (macOptionIsMeta) => {
      await act(async () => root.render(<Harness pty={pty} inputContext="agent" />));
      pty.terminal.options.macOptionIsMeta = macOptionIsMeta;
      press('ArrowLeft');
      press('ArrowRight');
      press('ArrowUp');
      press('ArrowDown');
      expect(input).toEqual(['\x1b[1;3D', '\x1b[1;3C', '\x1b[1;3A', '\x1b[1;3B']);
    }
  );

  it('updates navigation when the same PTY changes input context', async () => {
    press('ArrowUp');
    await act(async () => root.render(<Harness pty={pty} inputContext="agent" />));
    press('ArrowUp');
    await act(async () => root.render(<Harness pty={pty} inputContext="shell" />));
    press('ArrowUp');
    expect(input).toEqual(['\x01', '\x1b[1;3A', '\x01']);
  });

  it('forwards repeated agent keydowns without also sending on keyup', async () => {
    await act(async () => root.render(<Harness pty={pty} inputContext="agent" />));
    press('ArrowUp');
    press('ArrowUp', { altKey: true, repeat: true });
    press('ArrowUp', { altKey: true, repeat: true });
    expect(input).toEqual(['\x1b[1;3A', '\x1b[1;3A', '\x1b[1;3A']);
  });

  it('retains plain arrows and other modified arrow sequences', () => {
    press('ArrowLeft', {});
    press('ArrowUp', {});
    press('ArrowLeft', { altKey: true, shiftKey: true });
    press('ArrowRight', { altKey: true, ctrlKey: true });
    expect(input).toEqual(['\x1b[D', '\x1b[A', '\x1b[1;4D', '\x1b[1;7C']);
  });

  it.each(['shell', 'agent'] as const)(
    'does not send input from a read-only %s',
    async (inputContext) => {
      await act(async () =>
        root.render(<Harness pty={pty} inputContext={inputContext} readOnly />)
      );
      for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) press(key);
      expect(input).toEqual([]);
    }
  );

  it('allows repeated keydowns without also sending on keyup', () => {
    press('ArrowLeft');
    press('ArrowLeft', { altKey: true, repeat: true });
    press('ArrowLeft', { altKey: true, repeat: true });
    expect(input).toEqual(['\x1bb', '\x1bb', '\x1bb']);
  });

  it.each(['shell', 'agent'] as const)(
    'does not send %s input while another modal owns focus',
    async (inputContext) => {
      await act(async () => root.render(<Harness pty={pty} inputContext={inputContext} />));
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      document.body.appendChild(dialog);
      try {
        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) press(key);
        expect(input).toEqual([]);
      } finally {
        dialog.remove();
      }
    }
  );
});
