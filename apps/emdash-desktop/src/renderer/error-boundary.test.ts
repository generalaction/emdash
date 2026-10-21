import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './error-boundary';

const mocks = vi.hoisted(() => ({
  deleteAll: vi.fn(),
  flush: vi.fn(),
}));

vi.mock('@core/primitives/mementos/browser', () => ({
  getMementoClient: () => ({
    deleteAll: mocks.deleteAll,
    flush: mocks.flush,
  }),
}));

describe('ErrorBoundary reload', () => {
  const reload = vi.fn();
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  function button(label: string): HTMLButtonElement {
    const result = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent === label
    );
    expect(result, `Missing recovery button: ${label}`).toBeDefined();
    return result!;
  }

  async function click(label: string): Promise<void> {
    await act(async () => button(label).click());
  }

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.flush.mockResolvedValue(undefined);
    mocks.deleteAll.mockResolvedValue(0);
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal(
      'window',
      new Proxy(dom.window, {
        get: (target, property) =>
          property === 'location' ? { reload } : Reflect.get(target, property),
      })
    );
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container, { onCaughtError: () => {} });
    function CrashingView(): never {
      throw new Error('Cannot render saved layout');
    }
    act(() => {
      root.render(React.createElement(ErrorBoundary, {}, React.createElement(CrashingView)));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('flushes pending UI state without deleting saved mementos', async () => {
    await click('Reload app');

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(mocks.flush).toHaveBeenCalledOnce();
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });

  it('still reloads when pending UI state cannot be flushed', async () => {
    mocks.flush.mockRejectedValueOnce(new Error('wire unavailable'));

    await click('Reload app');

    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });

  it('offers an explicit reset after a rendering crash and explains what is lost', async () => {
    expect(button('Still having trouble?').getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Reset UI state and reload');

    await click('Still having trouble?');

    expect(container.textContent).toContain('unsent drafts');

    await click('Reset UI state and reload');

    expect(mocks.deleteAll).toHaveBeenCalledOnce();
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('keeps technical details collapsed until requested', async () => {
    expect(container.querySelector('h1')?.textContent).toBe('Emdash couldn’t display that view');
    expect(container.textContent).toContain('Reload to try again with your saved layout.');
    expect(button('Error details').getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Cannot render saved layout');

    await click('Error details');

    expect(button('Error details').getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('pre')?.textContent).toBe('Cannot render saved layout');
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(mocks.deleteAll).not.toHaveBeenCalled();
  });

  it('waits for reset to finish and prevents a competing reload', async () => {
    let finishReset!: (deleted: number) => void;
    mocks.deleteAll.mockReturnValueOnce(
      new Promise<number>((resolve) => {
        finishReset = resolve;
      })
    );

    await click('Still having trouble?');
    await click('Reset UI state and reload');
    expect(button('Reload app').disabled).toBe(true);
    expect(button('Reset UI state and reload').disabled).toBe(true);
    await click('Reload app');
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    await act(async () => finishReset(1));
    expect(reload).toHaveBeenCalledOnce();
  });

  it('shows a failed reset without reloading and allows retry', async () => {
    mocks.deleteAll.mockRejectedValueOnce(new Error('wire unavailable'));

    await click('Still having trouble?');
    await click('Reset UI state and reload');

    expect(reload).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not reset UI state'
    );
    expect(button('Reset UI state and reload').disabled).toBe(false);

    await click('Still having trouble?');
    expect(button('Still having trouble?').getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Could not reset UI state'
    );

    await click('Still having trouble?');
    await click('Reset UI state and reload');
    expect(mocks.deleteAll).toHaveBeenCalledTimes(2);
    expect(mocks.flush).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
