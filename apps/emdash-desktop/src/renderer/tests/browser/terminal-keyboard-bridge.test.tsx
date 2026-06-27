import { detectPlatform, getHotkeyManager, type HotkeyRegistrationHandle } from '@tanstack/hotkeys';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The bridge reads the command-palette hotkey from app settings; with no
// overrides it falls back to the 'Mod+K' default.
vi.mock('@renderer/features/settings/use-app-settings-key', () => ({
  useAppSettingsKey: () => ({ value: undefined }),
}));

import { TerminalKeyboardBridge } from '@renderer/lib/components/terminal-keyboard-bridge';

// 'Mod' resolves to Cmd on macOS and Ctrl on Windows/Linux. This test is the
// non-mac case (xterm only swallows Ctrl combos), but stay portable so it also
// passes on a macOS CI runner.
const PRIMARY_MODIFIER: 'metaKey' | 'ctrlKey' = detectPlatform() === 'mac' ? 'metaKey' : 'ctrlKey';

function pressKey(target: EventTarget, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    [PRIMARY_MODIFIER]: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

function flush(): Promise<void> {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  );
}

describe('TerminalKeyboardBridge', () => {
  let root: Root;
  let rootContainer: HTMLDivElement;
  let xtermHost: HTMLDivElement;
  let xtermInput: HTMLTextAreaElement;
  let outsideInput: HTMLInputElement;
  const handles: HotkeyRegistrationHandle[] = [];

  function registerHotkey(hotkey: string, callback: () => void): void {
    handles.push(
      getHotkeyManager().register(hotkey, () => callback(), {
        // Disable the manager's own preventDefault/stopPropagation so a
        // document bubble-phase spy can observe whether the bridge stopped the
        // event during the capture phase.
        preventDefault: false,
        stopPropagation: false,
      })
    );
  }

  beforeEach(async () => {
    rootContainer = document.createElement('div');
    document.body.appendChild(rootContainer);
    root = createRoot(rootContainer);
    root.render(createElement(TerminalKeyboardBridge));
    await flush();

    xtermHost = document.createElement('div');
    xtermHost.className = 'xterm';
    xtermInput = document.createElement('textarea');
    xtermHost.appendChild(xtermInput);
    document.body.appendChild(xtermHost);

    outsideInput = document.createElement('input');
    document.body.appendChild(outsideInput);
  });

  afterEach(() => {
    for (const handle of handles.splice(0)) handle.unregister();
    root.unmount();
    rootContainer.remove();
    xtermHost.remove();
    outsideInput.remove();
    vi.restoreAllMocks();
  });

  it('fires the command palette shortcut when a terminal is focused', async () => {
    const paletteSpy = vi.fn();
    const bubbleSpy = vi.fn();
    registerHotkey('Mod+K', paletteSpy);
    document.addEventListener('keydown', bubbleSpy);

    xtermInput.focus();
    expect(document.activeElement).toBe(xtermInput);
    pressKey(xtermInput, 'k');

    expect(paletteSpy).toHaveBeenCalledTimes(1);
    // The bridge stops propagation so the manager's bubble listener doesn't
    // double-dispatch and xterm never consumes the key.
    expect(bubbleSpy).not.toHaveBeenCalled();

    document.removeEventListener('keydown', bubbleSpy);
  });

  it('stays out of the way when no terminal is focused', async () => {
    const paletteSpy = vi.fn();
    const bubbleSpy = vi.fn();
    registerHotkey('Mod+K', paletteSpy);
    document.addEventListener('keydown', bubbleSpy);

    outsideInput.focus();
    pressKey(outsideInput, 'k');

    // The bridge is inert: the event propagates normally to document listeners.
    expect(paletteSpy).toHaveBeenCalledTimes(1);
    expect(bubbleSpy).toHaveBeenCalledTimes(1);

    document.removeEventListener('keydown', bubbleSpy);
  });

  it('lets non-flagged shortcuts reach the terminal so control keys keep working', async () => {
    const drawerSpy = vi.fn();
    const bubbleSpy = vi.fn();
    // Mod+J (terminal drawer) is NOT flagged overrideTerminalFocus, so the
    // bridge must not intercept it — Ctrl+J stays available to the shell.
    registerHotkey('Mod+J', drawerSpy);
    document.addEventListener('keydown', bubbleSpy);

    xtermInput.focus();
    pressKey(xtermInput, 'j');

    // Bridge does not stop the event, so it propagates to the bubble listener.
    expect(bubbleSpy).toHaveBeenCalledTimes(1);

    document.removeEventListener('keydown', bubbleSpy);
  });
});
