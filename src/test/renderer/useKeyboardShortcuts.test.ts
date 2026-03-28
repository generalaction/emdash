import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  focusedTerminalProviderReservesShortcut,
  getAgentTabSelectionIndex,
  getFocusedTerminalProviderId,
} from '../../renderer/hooks/useKeyboardShortcuts';

type MockNode = {
  getAttribute: (name: string) => string | null;
  closest: (selector: string) => MockNode | null;
  querySelector: (selector: string) => MockNode | null;
  classList: {
    contains: (value: string) => boolean;
  };
};

function createNode({
  attrs = {},
  classes = [],
  closestMap = {},
  querySelectorMap = {},
}: {
  attrs?: Record<string, string>;
  classes?: string[];
  closestMap?: Record<string, MockNode | null>;
  querySelectorMap?: Record<string, MockNode | null>;
} = {}): MockNode {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    closest: (selector: string) => closestMap[selector] ?? null,
    querySelector: (selector: string) => querySelectorMap[selector] ?? null,
    classList: {
      contains: (value: string) => classes.includes(value),
    },
  };
}

function createKeyEvent({
  key,
  metaKey = false,
  ctrlKey = false,
  altKey = false,
  shiftKey = false,
}: {
  key: string;
  metaKey?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
}): Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'> {
  return {
    key,
    metaKey,
    ctrlKey,
    altKey,
    shiftKey,
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.doUnmock('react');
});

describe('getAgentTabSelectionIndex', () => {
  it('maps Cmd/Ctrl+1 through Cmd/Ctrl+9 to zero-based tab indexes', () => {
    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(0);

    expect(
      getAgentTabSelectionIndex({
        key: '9',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBe(8);
  });

  it('accepts Ctrl+number as the Command equivalent on non-mac platforms', () => {
    expect(
      getAgentTabSelectionIndex(
        {
          key: '4',
          metaKey: false,
          ctrlKey: true,
          altKey: false,
          shiftKey: false,
        } as KeyboardEvent,
        false
      )
    ).toBe(3);
  });

  it('ignores keys outside 1-9 and modified variants', () => {
    expect(
      getAgentTabSelectionIndex({
        key: '0',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: false,
        shiftKey: true,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: true,
        ctrlKey: false,
        altKey: true,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();

    expect(
      getAgentTabSelectionIndex({
        key: '1',
        metaKey: false,
        ctrlKey: false,
        altKey: false,
        shiftKey: false,
      } as KeyboardEvent)
    ).toBeNull();
  });
});

describe('getFocusedTerminalProviderId', () => {
  it('recovers the provider from the focused xterm helper textarea', () => {
    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'copilot' } });
    const helperTextarea = createNode({
      classes: ['xterm-helper-textarea'],
      closestMap: { '[data-terminal-provider-id]': providerRoot },
    });

    expect(getFocusedTerminalProviderId(helperTextarea as unknown as EventTarget, null)).toBe(
      'copilot'
    );
  });

  it('falls back to the terminal host when the host is the event target', () => {
    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'copilot' } });
    const helperTextarea = createNode({
      classes: ['xterm-helper-textarea'],
      closestMap: { '[data-terminal-provider-id]': providerRoot },
    });
    const terminalHost = createNode({
      attrs: { 'data-terminal-host': 'true' },
      querySelectorMap: { '.xterm-helper-textarea': helperTextarea },
    });

    expect(
      getFocusedTerminalProviderId(
        terminalHost as unknown as EventTarget,
        helperTextarea as unknown as MockNode
      )
    ).toBe('copilot');
  });
});

describe('focusedTerminalProviderReservesShortcut', () => {
  it('bypasses Cmd+E for GitHub Copilot on macOS', () => {
    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'copilot' } });
    const helperTextarea = createNode({
      classes: ['xterm-helper-textarea'],
      closestMap: { '[data-terminal-provider-id]': providerRoot },
    });

    expect(
      focusedTerminalProviderReservesShortcut(
        helperTextarea as unknown as EventTarget,
        createKeyEvent({ key: 'e', metaKey: true }),
        null,
        true
      )
    ).toBe(true);
  });

  it('bypasses Ctrl+E for GitHub Copilot on non-mac platforms', () => {
    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'copilot' } });
    const helperTextarea = createNode({
      classes: ['xterm-helper-textarea'],
      closestMap: { '[data-terminal-provider-id]': providerRoot },
    });
    const terminalHost = createNode({
      attrs: { 'data-terminal-host': 'true' },
      querySelectorMap: { '.xterm-helper-textarea': helperTextarea },
    });

    expect(
      focusedTerminalProviderReservesShortcut(
        terminalHost as unknown as EventTarget,
        createKeyEvent({ key: 'e', ctrlKey: true }),
        helperTextarea as unknown as MockNode,
        false
      )
    ).toBe(true);
  });

  it('keeps intercepting matching shortcuts for other terminal providers', () => {
    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'claude' } });
    const helperTextarea = createNode({
      classes: ['xterm-helper-textarea'],
      closestMap: { '[data-terminal-provider-id]': providerRoot },
    });

    expect(
      focusedTerminalProviderReservesShortcut(
        helperTextarea as unknown as EventTarget,
        createKeyEvent({ key: 'e', metaKey: true }),
        null,
        true
      )
    ).toBe(false);
  });

  it('keeps intercepting matching shortcuts outside terminal focus', () => {
    const plainInput = createNode();

    expect(
      focusedTerminalProviderReservesShortcut(
        plainInput as unknown as EventTarget,
        createKeyEvent({ key: 'e', metaKey: true }),
        null,
        true
      )
    ).toBe(false);
  });
});

describe('useKeyboardShortcuts integration', () => {
  it('does not intercept the editor shortcut while Copilot terminal focus is active', async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNavigator = globalThis.navigator;

    let cleanup: (() => void) | undefined;
    let keydownListener: ((event: KeyboardEvent) => void) | null = null;
    const addEventListener = vi.fn((type: string, listener: EventListenerOrEventListenerObject) => {
      if (type === 'keydown' && typeof listener === 'function') {
        keydownListener = listener as (event: KeyboardEvent) => void;
      }
    });
    const removeEventListener = vi.fn();

    const providerRoot = createNode({ attrs: { 'data-terminal-provider-id': 'copilot' } });
    const helperTextarea = {
      ...createNode({
        classes: ['xterm-helper-textarea'],
        closestMap: { '[data-terminal-provider-id]': providerRoot },
      }),
      tagName: 'TEXTAREA',
      isContentEditable: false,
    };

    Object.defineProperty(globalThis, 'navigator', {
      value: { platform: 'Linux x86_64' },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'window', {
      value: {
        addEventListener,
        removeEventListener,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'document', {
      value: {
        activeElement: helperTextarea,
        querySelector: vi.fn(() => null),
      },
      configurable: true,
    });

    vi.resetModules();
    vi.doMock('react', () => ({
      useEffect: (effect: () => void | (() => void)) => {
        cleanup = effect() ?? undefined;
      },
      useMemo: <T>(factory: () => T) => factory(),
    }));

    try {
      const { useKeyboardShortcuts } = await import('../../renderer/hooks/useKeyboardShortcuts');
      const onToggleEditor = vi.fn();

      useKeyboardShortcuts({ onToggleEditor });

      expect(addEventListener).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      expect(keydownListener).not.toBeNull();

      const event = {
        key: 'e',
        metaKey: false,
        ctrlKey: true,
        altKey: false,
        shiftKey: false,
        target: helperTextarea,
        defaultPrevented: false,
        preventDefault: vi.fn(),
      } as unknown as KeyboardEvent & {
        defaultPrevented: boolean;
        preventDefault: () => void;
      };
      event.preventDefault = () => {
        event.defaultPrevented = true;
      };

      keydownListener!(event);

      expect(event.defaultPrevented).toBe(false);
      expect(onToggleEditor).not.toHaveBeenCalled();

      cleanup?.();
      expect(removeEventListener).toHaveBeenCalledWith('keydown', keydownListener, true);
    } finally {
      if (originalNavigator === undefined) {
        delete (globalThis as { navigator?: Navigator }).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          value: originalNavigator,
          configurable: true,
        });
      }

      if (originalWindow === undefined) {
        delete (globalThis as { window?: Window & typeof globalThis }).window;
      } else {
        Object.defineProperty(globalThis, 'window', {
          value: originalWindow,
          configurable: true,
        });
      }

      if (originalDocument === undefined) {
        delete (globalThis as { document?: Document }).document;
      } else {
        Object.defineProperty(globalThis, 'document', {
          value: originalDocument,
          configurable: true,
        });
      }
    }
  });
});
