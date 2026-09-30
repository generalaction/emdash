import type { UserMessageNavigation } from '@emdash/chat-ui';
import '@emdash/ui/style.css';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { AcpMessageNavigator } from './acp-message-navigator';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('AcpMessageNavigator', () => {
  let host: HTMLDivElement;
  let root: Root;
  let navigation: UserMessageNavigation;
  const onNavigate = vi.fn();
  const onLoadOlder = vi.fn();

  beforeEach(async () => {
    await page.viewport(800, 700);
    host = document.createElement('div');
    host.className = 'emlight';
    host.style.cssText = 'position:relative;width:640px;height:500px;font-family:system-ui';
    document.body.append(host);
    root = createRoot(host);
    navigation = {
      items: Array.from({ length: 2000 }, (_, index) => ({
        id: `message-${index}`,
        text: `Request ${index + 1}`,
      })),
      currentId: 'message-1999',
      bottomInset: 100,
      viewportHeight: 500,
    };
    onNavigate.mockClear();
    onLoadOlder.mockClear();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  async function render(hasOlderHistory = false) {
    await act(async () =>
      root.render(
        <AcpMessageNavigator
          navigation={navigation}
          hasOlderHistory={hasOlderHistory}
          loading={false}
          error={null}
          onLoadOlder={onLoadOlder}
          onNavigate={onNavigate}
        />
      )
    );
  }

  const marker = (ordinal: number) =>
    page.getByRole('button', { name: `Go to message ${ordinal}: Request ${ordinal}`, exact: true });
  const markers = () => [...host.querySelectorAll<HTMLButtonElement>('[data-message-id]')];
  const tabStops = () => markers().filter((button) => button.tabIndex === 0);
  const viewport = () => host.querySelector<HTMLElement>('.scroll-fade__viewport')!;

  function expectInsideViewport(element: Element) {
    const bounds = element.getBoundingClientRect();
    const viewportBounds = viewport().getBoundingClientRect();
    expect(bounds.top).toBeGreaterThanOrEqual(viewportBounds.top - 1);
    expect(bounds.bottom).toBeLessThanOrEqual(viewportBounds.bottom + 1);
  }

  it('bounds 2000 loaded markers while Home, End, and Enter retain exact IDs and global ordinals', async () => {
    await render();
    const last = marker(2000);
    await expect.element(last).toHaveAttribute('aria-current', 'step');
    await vi.waitFor(() => expectInsideViewport(last.element()));
    expect(markers().length).toBeLessThanOrEqual(30);
    expect(tabStops()).toEqual([last.element()]);

    await act(async () => (last.element() as HTMLButtonElement).focus());
    await act(async () => userEvent.keyboard('{Home}'));
    const first = marker(1);
    await expect.element(first).toHaveFocus();
    await vi.waitFor(() => expectInsideViewport(first.element()));
    await expect.element(page.getByText('Message 1 of 2000', { exact: true })).toBeVisible();
    expect(tabStops()).toEqual([first.element()]);
    expect(markers().length).toBeLessThanOrEqual(30);
    expect(onNavigate).not.toHaveBeenCalled();
    await act(async () => userEvent.keyboard('{Enter}'));
    expect(onNavigate).toHaveBeenLastCalledWith('message-0');

    await act(async () => userEvent.keyboard('{End}'));
    await expect.element(last).toHaveFocus();
    await vi.waitFor(() => expectInsideViewport(last.element()));
    await expect.element(page.getByText('Message 2000 of 2000', { exact: true })).toBeVisible();
    expect(tabStops()).toEqual([last.element()]);
    expect(markers().length).toBeLessThanOrEqual(30);
    await act(async () => userEvent.keyboard('{Enter}'));
    expect(onNavigate.mock.calls).toEqual([['message-0'], ['message-1999']]);
  });

  it('mounts earlier markers after wheel scrolling and retains one marker tab stop', async () => {
    await render();
    const last = marker(2000);
    await vi.waitFor(() => expectInsideViewport(last.element()));
    await act(async () => (last.element() as HTMLButtonElement).focus());
    const beforeScroll = viewport().scrollTop;
    const firstMounted = () =>
      Math.min(...markers().map((button) => Number(button.dataset.messageId!.split('-')[1])));
    const beforeFirst = firstMounted();
    await act(async () => userEvent.wheel(viewport(), { delta: { y: -720 } }));
    await vi.waitFor(() => {
      expect(viewport().scrollTop).toBeLessThan(beforeScroll);
      expect(firstMounted()).toBeLessThan(beforeFirst);
    });
    expect(markers().length).toBeLessThanOrEqual(30);
    expect(tabStops()).toEqual([last.element()]);
    await expect.element(last).toHaveFocus();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('keeps outside focus after Home is pressed again on the first marker', async () => {
    const input = document.createElement('input');
    input.ariaLabel = 'Outside draft';
    document.body.append(input);
    try {
      await render();
      await act(async () => (marker(2000).element() as HTMLButtonElement).focus());
      await act(async () => userEvent.keyboard('{Home}'));
      await expect.element(marker(1)).toHaveFocus();
      await act(async () => userEvent.keyboard('{Home}'));
      await act(async () => input.focus());
      navigation = { ...navigation, bottomInset: 110 };
      await render();
      await expect.element(page.getByRole('textbox', { name: 'Outside draft' })).toHaveFocus();
    } finally {
      input.remove();
    }
  });

  it('keeps a middle current marker visible after the pane shrinks', async () => {
    navigation = { ...navigation, currentId: 'message-1000' };
    await render();
    const current = marker(1001);
    await vi.waitFor(() => expectInsideViewport(current.element()));
    host.style.height = '204px';
    navigation = { ...navigation, viewportHeight: 204 };
    await render();
    await vi.waitFor(() => expectInsideViewport(current.element()));
    await expect.element(current).toHaveAttribute('aria-current', 'step');
  });

  it('removes interactive controls when an expanded composer fills a 150px pane and restores them when space returns', async () => {
    host.style.height = '150px';
    navigation = { ...navigation, viewportHeight: 150, bottomInset: 128 };
    await render(true);
    expect(host.querySelectorAll('button')).toHaveLength(0);

    navigation = { ...navigation, bottomInset: 70 };
    await render(true);
    const loadOlder = page.getByRole('button', { name: 'Load earlier messages', exact: true });
    await expect.element(loadOlder).toBeVisible();
    await expect.element(marker(2000)).toBeVisible();
    await vi.waitFor(() => expectInsideViewport(marker(2000).element()));
    const paneBounds = host.getBoundingClientRect();
    const buttonBounds = loadOlder.element().getBoundingClientRect();
    expect(buttonBounds.top).toBeGreaterThanOrEqual(paneBounds.top);
    expect(buttonBounds.bottom).toBeLessThanOrEqual(paneBounds.bottom - navigation.bottomInset + 1);
    expect(viewport().getBoundingClientRect().bottom).toBeLessThanOrEqual(
      paneBounds.bottom - navigation.bottomInset + 1
    );
  });

  it.each([32, 48])(
    'keeps earlier-history loading accessible with only %ipx above the composer',
    async (availableHeight) => {
      host.style.height = '150px';
      navigation = {
        ...navigation,
        viewportHeight: 150,
        bottomInset: 150 - 16 - availableHeight,
      };
      await render(true);
      const loadOlder = page.getByRole('button', { name: 'Load earlier messages', exact: true });
      await expect.element(loadOlder).toBeVisible();
      expect(markers()).toHaveLength(0);
      expect(host.querySelectorAll('button')).toHaveLength(1);
      const paneBounds = host.getBoundingClientRect();
      const buttonBounds = loadOlder.element().getBoundingClientRect();
      expect(buttonBounds.top).toBeGreaterThanOrEqual(paneBounds.top + 16 - 1);
      expect(buttonBounds.bottom).toBeLessThanOrEqual(
        paneBounds.bottom - navigation.bottomInset + 1
      );
      await act(async () => loadOlder.click());
      expect(onLoadOlder).toHaveBeenCalledOnce();
    }
  );
});
