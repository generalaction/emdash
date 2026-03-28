import { describe, it, expect, vi, afterEach } from 'vitest';
import { shouldAllowTerminalAutoFocus } from '../../renderer/lib/terminalFocusPolicy';

/**
 * Mock document.activeElement by temporarily injecting a global `document`
 * object. The policy function only reads `document.activeElement` and calls
 * `.closest()` / `.tagName` / `.isContentEditable` on the element, so we
 * can stub that with plain objects.
 */

function makeElement(opts: {
  tagName?: string;
  isContentEditable?: boolean;
  closestResults?: Record<string, boolean>;
}): HTMLElement {
  const el = {
    tagName: opts.tagName ?? 'DIV',
    isContentEditable: opts.isContentEditable ?? false,
    closest: (selector: string) => {
      if (opts.closestResults?.[selector]) return el;
      return null;
    },
  } as unknown as HTMLElement;
  return el;
}

function setActiveElement(el: HTMLElement | null) {
  (globalThis as any).document = {
    activeElement: el,
    body: { tagName: 'BODY' } as unknown as HTMLElement,
  };
}

afterEach(() => {
  delete (globalThis as any).document;
});

describe('shouldAllowTerminalAutoFocus', () => {
  it('returns false when document is undefined (SSR)', () => {
    // document is not defined by default in node env
    delete (globalThis as any).document;
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns true when activeElement is null', () => {
    setActiveElement(null);
    expect(shouldAllowTerminalAutoFocus()).toBe(true);
  });

  it('returns true when activeElement is body', () => {
    // Simulate body being the activeElement
    (globalThis as any).document = {
      activeElement: { tagName: 'BODY' },
      body: { tagName: 'BODY' },
    };
    // activeElement === document.body check uses object identity
    (globalThis as any).document.activeElement = (globalThis as any).document.body;
    expect(shouldAllowTerminalAutoFocus()).toBe(true);
  });

  it('returns false when an <input> is focused', () => {
    setActiveElement(makeElement({ tagName: 'INPUT' }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when a <textarea> is focused', () => {
    setActiveElement(makeElement({ tagName: 'TEXTAREA' }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when a <select> is focused', () => {
    setActiveElement(makeElement({ tagName: 'SELECT' }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when a contentEditable element is focused', () => {
    setActiveElement(makeElement({ isContentEditable: true }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when focus is inside a dialog', () => {
    setActiveElement(
      makeElement({
        tagName: 'BUTTON',
        closestResults: { '[role="dialog"]': true },
      })
    );
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when an input inside a dialog is focused', () => {
    setActiveElement(
      makeElement({
        tagName: 'INPUT',
        closestResults: { '[role="dialog"]': true },
      })
    );
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns true when focus is on xterm helper textarea (real-world terminal focus)', () => {
    // In production, when a terminal has focus, document.activeElement IS
    // the .xterm-helper-textarea — a <textarea>. The terminal-selector check
    // must run before isEditableElement so this returns true.
    setActiveElement(
      makeElement({
        tagName: 'TEXTAREA',
        closestResults: {
          '[data-terminal-container],.xterm,.xterm-helper-textarea,[data-expanded-terminal="true"]': true,
        },
      })
    );
    expect(shouldAllowTerminalAutoFocus()).toBe(true);
  });

  it('returns true when focus is on a terminal container', () => {
    setActiveElement(
      makeElement({
        tagName: 'DIV',
        closestResults: {
          '[data-terminal-container],.xterm,.xterm-helper-textarea,[data-expanded-terminal="true"]': true,
        },
      })
    );
    expect(shouldAllowTerminalAutoFocus()).toBe(true);
  });

  it('returns false when focus is on a generic button (non-terminal UI)', () => {
    setActiveElement(makeElement({ tagName: 'BUTTON' }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });

  it('returns false when focus is on a sidebar link', () => {
    setActiveElement(makeElement({ tagName: 'A' }));
    expect(shouldAllowTerminalAutoFocus()).toBe(false);
  });
});
