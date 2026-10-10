import type { UserMessageNavigation } from '@emdash/chat-ui';
import { Tooltip } from '@emdash/ui/react/primitives';
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

type Color = [number, number, number, number];

function color(css: string): Color {
  // Canvas converts CSS colors (including display-p3) to its default sRGB pixels.
  const context = document.createElement('canvas').getContext('2d')!;
  context.fillStyle = css;
  context.fillRect(0, 0, 1, 1);
  return Array.from(context.getImageData(0, 0, 1, 1).data, (channel) => channel / 255) as Color;
}

function composite(foreground: Color, background: Color, opacity = 1): Color {
  const alpha = foreground[3] * opacity;
  return [
    foreground[0] * alpha + background[0] * (1 - alpha),
    foreground[1] * alpha + background[1] * (1 - alpha),
    foreground[2] * alpha + background[2] * (1 - alpha),
    1,
  ];
}

function luminance([r, g, b]: Color): number {
  const linear = (channel: number) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(foreground: Color, background: Color): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

describe('AcpMessageNavigator', () => {
  let host: HTMLDivElement;
  let root: Root;
  let navigation: UserMessageNavigation;
  let originalTheme: string;
  const onNavigate = vi.fn();
  const onLoadOlder = vi.fn();

  beforeEach(async () => {
    await page.viewport(800, 700);
    originalTheme = document.documentElement.className;
    document.documentElement.classList.remove('emlight', 'emdark');
    document.documentElement.classList.add('emlight');
    host = document.createElement('div');
    host.className = 'surface-paper';
    host.style.cssText =
      'position:relative;width:640px;height:500px;font-family:system-ui;background:var(--em-surface)';
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
    document.documentElement.className = originalTheme;
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

  it.each(['emlight', 'emdark'])(
    'shows readable translucent previews and earlier-history hints on keyboard focus in %s',
    async (theme) => {
      document.documentElement.classList.replace('emlight', theme);
      await render(true);
      const paper = color(getComputedStyle(host).backgroundColor);
      const expectSurface = async (...texts: string[]) => {
        const preview = page.getByText(texts[0], { exact: true });
        await expect.element(preview).toBeVisible();
        const tooltip = preview.element().closest('[data-slot="tooltip-content"]')!;
        await vi.waitFor(() => expect(getComputedStyle(tooltip).opacity).toBe('1'));
        const background = color(getComputedStyle(tooltip).backgroundColor);
        expect(background[3]).toBeGreaterThan(0);
        expect(background[3]).toBeLessThan(1);
        const paintedBackground = composite(background, paper);
        expect(luminance(paintedBackground) > 0.5).toBe(theme === 'emlight');
        for (const text of texts) {
          const content = page.getByText(text, { exact: true });
          await expect.element(content).toBeVisible();
          const style = getComputedStyle(content.element());
          const foreground = composite(
            color(style.color),
            paintedBackground,
            Number(style.opacity)
          );
          expect(contrast(foreground, paintedBackground)).toBeGreaterThanOrEqual(4.5);
        }
      };

      await act(async () => userEvent.keyboard('{Tab}'));
      await expect
        .element(page.getByRole('button', { name: 'Load earlier messages', exact: true }))
        .toHaveFocus();
      await expectSurface('Load earlier messages');

      await act(async () => userEvent.keyboard('{Tab}'));
      await expect.element(marker(2000)).toHaveFocus();
      await expectSurface('Request 2000', 'Message 2000 of 2000');
    }
  );

  it.each(['emlight', 'emdark'])(
    'keeps inactive marker glyphs distinguishable from paper in %s',
    async (theme) => {
      document.documentElement.classList.replace('emlight', theme);
      await render();
      await vi.waitFor(() => expectInsideViewport(marker(2000).element()));
      const paper = color(getComputedStyle(host).backgroundColor);
      const inactive = marker(1999);
      await expect.element(inactive).toBeVisible();
      expect(inactive.element().hasAttribute('aria-current')).toBe(false);
      const style = getComputedStyle(inactive.element().querySelector('[aria-hidden="true"]')!);
      const background = composite(
        color(getComputedStyle(inactive.element()).backgroundColor),
        paper
      );
      const glyph = composite(color(style.backgroundColor), background, Number(style.opacity));
      expect(contrast(glyph, background)).toBeGreaterThanOrEqual(3);
    }
  );

  it.each(['emlight', 'emdark'])(
    'keeps the default tooltip opaque and inverted in %s',
    async (theme) => {
      document.documentElement.classList.replace('emlight', theme);
      await act(async () =>
        root.render(
          <Tooltip.Provider>
            <Tooltip.Root>
              <Tooltip.Trigger>Default hint</Tooltip.Trigger>
              <Tooltip.Content>Default tooltip text</Tooltip.Content>
            </Tooltip.Root>
          </Tooltip.Provider>
        )
      );
      await act(async () => userEvent.keyboard('{Tab}'));
      await expect.element(page.getByRole('button', { name: 'Default hint' })).toHaveFocus();
      const tooltip = page.getByText('Default tooltip text', { exact: true });
      await expect.element(tooltip).toBeVisible();
      const background = color(getComputedStyle(tooltip.element()).backgroundColor);
      expect(background[3]).toBe(1);
      expect(luminance(background) > 0.5).toBe(theme === 'emdark');
    }
  );

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

  it('keeps outside focus when the rail collapses while Home is queued and later reopens', async () => {
    const renderNavigator = () => (
      <div
        onKeyDown={(event) => {
          if (event.key === 'Home') {
            navigation = { ...navigation, bottomInset: 490 };
            root.render(renderNavigator());
          }
        }}
      >
        <AcpMessageNavigator
          navigation={navigation}
          hasOlderHistory={false}
          loading={false}
          error={null}
          onLoadOlder={onLoadOlder}
          onNavigate={onNavigate}
        />
        <input aria-label="Outside draft" />
      </div>
    );
    await act(async () => root.render(renderNavigator()));
    await vi.waitFor(() => expectInsideViewport(marker(2000).element()));
    await act(async () => (marker(2000).element() as HTMLButtonElement).focus());
    await act(async () => userEvent.keyboard('{Home}'));
    expect(markers()).toHaveLength(0);

    const draft = page.getByRole('textbox', { name: 'Outside draft' });
    await act(async () => (draft.element() as HTMLInputElement).focus());
    await expect.element(draft).toHaveFocus();
    navigation = { ...navigation, bottomInset: 100 };
    await act(async () => root.render(renderNavigator()));
    await expect.element(marker(1)).toBeInTheDocument();
    await expect.element(draft).toHaveFocus();
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
