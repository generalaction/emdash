import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProviderCustomConfig } from '@shared/core/app-settings';
import { InstalledAgentContent, type InstalledAgentContentProps } from './InstalledAgentContent';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
}));

vi.mock('@renderer/lib/hooks/use-toast', () => ({
  toast: mocks.toast,
}));

vi.mock('@renderer/lib/ui/button', async () => {
  const React = await import('react');

  return {
    Button: ({
      children,
      variant: _variant,
      size: _size,
      ...props
    }: React.ComponentProps<'button'> & {
      variant?: string;
      size?: string;
    }) => React.createElement('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/collapsible', async () => {
  const React = await import('react');

  return {
    Collapsible: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    CollapsibleContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    CollapsibleTrigger: ({
      children,
      ...props
    }: React.ComponentProps<'button'> & { children: React.ReactNode }) =>
      React.createElement('button', props, children),
  };
});

vi.mock('@renderer/lib/ui/input', async () => {
  const React = await import('react');

  return {
    Input: ({
      onChange,
      ...props
    }: React.ComponentProps<'input'> & {
      onChange?: React.ChangeEventHandler<HTMLInputElement>;
    }) => React.createElement('input', { ...props, onChange, onInput: onChange }),
  };
});

vi.mock('@renderer/lib/ui/tooltip', async () => {
  const React = await import('react');

  return {
    Tooltip: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipContent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipProvider: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
    TooltipTrigger: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', {}, children),
  };
});

function setInputValue(dom: JSDOM, input: HTMLInputElement, value: string): void {
  const valueSetter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value'
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
}

function click(dom: JSDOM, element: Element): void {
  element.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

describe('InstalledAgentContent', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;
  let update: InstalledAgentContentProps['update'];
  let reset: InstalledAgentContentProps['reset'];

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('HTMLInputElement', dom.window.HTMLInputElement);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
    update = vi.fn();
    reset = vi.fn((_val, opts) => opts?.onError?.(new Error('DB reset failed')));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    vi.clearAllMocks();
    dom.window.close();
  });

  function render(props: Partial<InstalledAgentContentProps> = {}): void {
    const defaultProps: InstalledAgentContentProps = {
      storedConfig: undefined,
      isOverridden: false,
      isLoading: false,
      update,
      reset,
    };

    root.render(React.createElement(InstalledAgentContent, { ...defaultProps, ...props }));
  }

  it('re-syncs stored values after a failed reset finishes loading', async () => {
    const storedConfig: ProviderCustomConfig = {
      env: { OPENAI_API_KEY: 'secret' },
    };

    await act(async () => render({ storedConfig, isOverridden: true }));

    expect(container.querySelector<HTMLInputElement>('input[placeholder="KEY"]')?.value).toBe(
      'OPENAI_API_KEY'
    );

    const resetButton = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Reset to defaults'
    );
    expect(resetButton).toBeDefined();

    await act(async () => click(dom, resetButton!));

    expect(container.querySelector('input[placeholder="KEY"]')).toBeNull();

    await act(async () => render({ storedConfig, isOverridden: true, isLoading: true }));
    await act(async () => render({ storedConfig, isOverridden: true, isLoading: false }));

    expect(container.querySelector<HTMLInputElement>('input[placeholder="KEY"]')?.value).toBe(
      'OPENAI_API_KEY'
    );
  });

  it('shows a toast when invalid environment variables cannot be saved on unmount', async () => {
    await act(async () => render());

    const addButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Add variable')
    );
    expect(addButton).toBeDefined();

    await act(async () => click(dom, addButton!));

    const keyInput = container.querySelector<HTMLInputElement>('input[placeholder="KEY"]');
    expect(keyInput).not.toBeNull();

    await act(async () => setInputValue(dom, keyInput!, 'OPENAI-KEY'));
    await act(async () => root.unmount());

    expect(mocks.toast).toHaveBeenCalledWith({
      title: 'Environment variables not saved',
      description: 'Fix invalid environment variable keys before closing this panel.',
      variant: 'destructive',
    });
    expect(update).not.toHaveBeenCalled();
  });
});
