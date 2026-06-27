import {
  detectPlatform,
  getHotkeyManager,
  type HotkeyRegistrationHandle,
  type RegisterableHotkey,
} from '@tanstack/hotkeys';
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

  function registerHotkey(hotkey: RegisterableHotkey, callback: () => void): void {
    handles.push(
      getHotkeyManager().register(hotkey, () => callback(), {
        // Disable the manager's own preventDefault/stopPropagation so a
        // document bubble-phase spy can observe whether the bridge stopped the
        // event during the capture phase.
        preventDefault: false,
        stopPropagation: false,
        conflictBehavior: 'allow',
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
    const xtermSpy = vi.fn((event: KeyboardEvent) => event.stopPropagation());
    registerHotkey('Mod+K', paletteSpy);
    xtermInput.addEventListener('keydown', xtermSpy);
    document.addEventListener('keydown', bubbleSpy);

    xtermInput.focus();
    expect(document.activeElement).toBe(xtermInput);
    const event = pressKey(xtermInput, 'k');

    expect(paletteSpy).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // The bridge stops propagation so the manager's bubble listener doesn't
    // double-dispatch and xterm never consumes the key.
    expect(xtermSpy).not.toHaveBeenCalled();
    expect(bubbleSpy).not.toHaveBeenCalled();

    xtermInput.removeEventListener('keydown', xtermSpy);
    document.removeEventListener('keydown', bubbleSpy);
  });

  it('fires every matching override shortcut registration from a focused terminal', async () => {
    const firstSpy = vi.fn();
    const secondSpy = vi.fn();
    const xtermSpy = vi.fn((event: KeyboardEvent) => event.stopPropagation());
    registerHotkey('Mod+K', firstSpy);
    registerHotkey('Mod+K', secondSpy);
    xtermInput.addEventListener('keydown', xtermSpy);

    xtermInput.focus();
    pressKey(xtermInput, 'k');

    expect(firstSpy).toHaveBeenCalledTimes(1);
    expect(secondSpy).toHaveBeenCalledTimes(1);
    expect(xtermSpy).not.toHaveBeenCalled();

    xtermInput.removeEventListener('keydown', xtermSpy);
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
    const xtermSpy = vi.fn((event: KeyboardEvent) => event.stopPropagation());
    // Mod+J (terminal drawer) is NOT flagged overrideTerminalFocus, so the
    // bridge must not intercept it — Ctrl+J stays available to the shell.
    registerHotkey('Mod+J', drawerSpy);
    xtermInput.addEventListener('keydown', xtermSpy);
    document.addEventListener('keydown', bubbleSpy);

    xtermInput.focus();
    pressKey(xtermInput, 'j');

    // Bridge does not stop the event, so xterm receives and consumes it before
    // TanStack's document-level bubble listener can dispatch the shortcut.
    expect(xtermSpy).toHaveBeenCalledTimes(1);
    expect(drawerSpy).not.toHaveBeenCalled();
    expect(bubbleSpy).not.toHaveBeenCalled();

    xtermInput.removeEventListener('keydown', xtermSpy);
    document.removeEventListener('keydown', bubbleSpy);
  });
});
