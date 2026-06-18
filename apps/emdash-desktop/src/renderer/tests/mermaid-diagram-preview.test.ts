import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MermaidDiagramPreview } from '@renderer/lib/ui/mermaid-diagram-preview';

describe('MermaidDiagramPreview', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('SVGElement', dom.window.SVGElement);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);
    vi.stubGlobal('PointerEvent', dom.window.PointerEvent);
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      dom.window.setTimeout(() => callback(Date.now()), 0)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: number) => dom.window.clearTimeout(id));

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('expands without triggering parent click handlers', () => {
    const onExpand = vi.fn();
    const onParentClick = vi.fn();

    act(() => {
      root.render(
        React.createElement(
          'div',
          { onClick: onParentClick },
          React.createElement(MermaidDiagramPreview, {
            svg: "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'></svg>",
            onExpand,
          })
        )
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Expand Mermaid diagram"]'
    );
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(
        new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })
      );
    });

    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it('expands linked diagram nodes instead of following their SVG anchors', () => {
    const onExpand = vi.fn();
    const onParentClick = vi.fn();

    act(() => {
      root.render(
        React.createElement(
          'div',
          { onClick: onParentClick },
          React.createElement(MermaidDiagramPreview, {
            svg: [
              "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'>",
              "<a href='https://example.com/'><rect width='120' height='40'></rect></a>",
              '</svg>',
            ].join(''),
            onExpand,
          })
        )
      );
    });

    const linkedNode = container.querySelector<SVGRectElement>('rect');
    expect(linkedNode).not.toBeNull();

    const event = new dom.window.MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      linkedNode?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onParentClick).not.toHaveBeenCalled();
  });

  it.each(['Enter', ' '])('expands preview with keyboard key "%s"', (key) => {
    const onExpand = vi.fn();
    const onParentKeyDown = vi.fn();

    act(() => {
      root.render(
        React.createElement(
          'div',
          { onKeyDown: onParentKeyDown },
          React.createElement(MermaidDiagramPreview, {
            svg: "<svg xmlns='http://www.w3.org/2000/svg' width='120' height='40'></svg>",
            onExpand,
          })
        )
      );
    });

    const preview = container.querySelector<HTMLDivElement>(
      '[aria-label="Expand Mermaid diagram preview"]'
    );
    expect(preview).not.toBeNull();

    const event = new dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key });
    act(() => {
      preview?.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(true);
    expect(onExpand).toHaveBeenCalledTimes(1);
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });
});
