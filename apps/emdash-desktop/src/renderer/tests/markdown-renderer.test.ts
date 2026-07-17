import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownRenderer } from '@renderer/lib/ui/markdown-renderer';

vi.mock('@renderer/lib/hooks/useTheme', () => ({
  useTheme: () => ({ effectiveTheme: 'emlight' }),
}));

vi.mock('@core/features/tasks/browser/stores/task-selectors', () => ({
  getTaskView: vi.fn(),
}));

vi.mock('@renderer/lib/stores/app-state', () => ({
  appState: {
    navigation: {
      currentViewId: 'home',
      viewParamsStore: {},
    },
  },
}));

vi.mock('@renderer/lib/runtime/desktop-host-client', () => ({
  events: {
    on: vi.fn(() => () => {}),
  },
  rpc: {
    app: {
      openExternal: vi.fn(),
    },
  },
}));

describe('MarkdownRenderer', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
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

  it('constrains markdown images in compact rendering', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content: '![Screenshot](https://example.com/screenshot.png)',
        variant: 'compact',
      })
    );

    expect(html).toContain('src="https://example.com/screenshot.png"');
    expect(html).toContain('alt="Screenshot"');
    expect(html).toContain('aria-label="Expand image"');
    expect(html).toContain('max-w-full');
    expect(html).toContain('max-h-80');
    expect(html).toContain('object-contain');
  });

  it('constrains allowed HTML images in compact rendering', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        allowHtml: true,
        content: '<img src="https://example.com/preview.png" alt="Preview">',
        variant: 'compact',
      })
    );

    expect(html).toContain('src="https://example.com/preview.png"');
    expect(html).toContain('alt="Preview"');
    expect(html).toContain('aria-label="Expand image"');
    expect(html).toContain('max-w-full');
    expect(html).toContain('max-h-80');
    expect(html).toContain('object-contain');
  });

  it('renders compact markdown tables with visible structure', () => {
    const html = renderToStaticMarkup(
      React.createElement(MarkdownRenderer, {
        content:
          '| Layer | What | How |\n| --- | --- | --- |\n| Primary | Headline | Display size |',
        variant: 'compact',
      })
    );

    expect(html).toContain('<table');
    expect(html).toContain('border-collapse');
    expect(html).toContain('<th');
    expect(html).toContain('<td');
    expect(html).toContain('Primary');
  });

  it('prevents browser navigation when a link handler claims a relative href', () => {
    const onOpenLink = vi.fn(() => true);

    act(() => {
      root.render(
        React.createElement(MarkdownRenderer, {
          content: '[booking.read](packages/trpc/server/routers/viewer/bookings/get.handler.ts)',
          onOpenLink,
          variant: 'full',
        })
      );
    });

    const link = container.querySelector<HTMLAnchorElement>('a[href]');
    expect(link).not.toBeNull();

    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link?.dispatchEvent(event);
    });

    expect(onOpenLink).toHaveBeenCalledWith(
      'packages/trpc/server/routers/viewer/bookings/get.handler.ts'
    );
    expect(event.defaultPrevented).toBe(true);
  });
});
