import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveConversationUiModeSelection } from './conversation-ui-mode-selection';
import { ConversationUiModeControl } from './ConversationUiModeControl';

function click(element: Element): void {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

describe('resolveConversationUiModeSelection', () => {
  it('returns the newly selected conversation UI mode', () => {
    expect(resolveConversationUiModeSelection('terminal', ['chat'])).toBe('chat');
    expect(resolveConversationUiModeSelection('chat', ['terminal'])).toBe('terminal');
  });

  it('ignores empty and invalid selections', () => {
    expect(resolveConversationUiModeSelection('terminal', [])).toBeNull();
    expect(resolveConversationUiModeSelection('terminal', ['terminal'])).toBeNull();
    expect(resolveConversationUiModeSelection('terminal', ['invalid'])).toBeNull();
  });
});

describe('ConversationUiModeControl', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('calls onUpdate when selecting chat', () => {
    const onUpdate = vi.fn();

    act(() => {
      root.render(
        React.createElement(ConversationUiModeControl, {
          conversationUiMode: 'terminal',
          isOverridden: false,
          disabled: false,
          onUpdate,
          onReset: vi.fn(),
        })
      );
    });

    act(() => {
      click(container.querySelector('[aria-label="Chat conversation UI"]')!);
    });

    expect(onUpdate).toHaveBeenCalledWith('chat');
  });

  it('calls onReset from the reset button and disables controls', () => {
    const onReset = vi.fn();
    const onUpdate = vi.fn();

    act(() => {
      root.render(
        React.createElement(ConversationUiModeControl, {
          conversationUiMode: 'chat',
          isOverridden: true,
          disabled: true,
          onUpdate,
          onReset,
        })
      );
    });

    const resetButton = container.querySelector('[aria-label="Reset to default"]')!;
    const terminalButton = container.querySelector('[aria-label="Terminal conversation UI"]')!;

    expect(resetButton).toHaveProperty('disabled', true);
    expect(terminalButton).toHaveProperty('disabled', true);

    act(() => {
      click(resetButton);
    });

    expect(onReset).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
