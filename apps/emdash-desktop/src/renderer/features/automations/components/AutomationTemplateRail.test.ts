import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  builtinAutomationCatalog,
  emptyStateAutomationTemplates,
} from '@shared/core/automations/builtin-catalog';
import { AutomationTemplateRail } from './AutomationTemplateRail';
import { AutomationTemplatesEmptyState } from './AutomationTemplatesEmptyState';

describe('AutomationTemplateRail', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('MouseEvent', dom.window.MouseEvent);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('renders all provided templates and selects a template', () => {
    const onSelect = vi.fn();

    act(() => {
      root.render(
        React.createElement(AutomationTemplateRail, {
          templates: builtinAutomationCatalog,
          onSelect,
        })
      );
    });

    expect(container.textContent).toContain('Find critical bugs');
    expect(container.textContent).toContain('Generate docs');
    expect(container.textContent).toContain('Add test coverage');
    expect(container.textContent).toContain('Scan for vulnerabilities');

    const firstTemplate = container.querySelector('button');
    expect(firstTemplate).not.toBeNull();

    act(() => {
      firstTemplate?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(onSelect).toHaveBeenCalledWith(builtinAutomationCatalog[0]);
  });

  it('renders the six initial templates in the empty state', () => {
    const onSelect = vi.fn();

    act(() => {
      root.render(
        React.createElement(AutomationTemplatesEmptyState, {
          templates: emptyStateAutomationTemplates,
          onSelectTemplate: onSelect,
        })
      );
    });

    const cards = Array.from(container.querySelectorAll('button'));
    expect(cards).toHaveLength(6);
    expect(cards.map((card) => card.textContent)).toEqual([
      expect.stringContaining('Find critical bugs'),
      expect.stringContaining('Generate docs'),
      expect.stringContaining('Add test coverage'),
      expect.stringContaining('Scan for vulnerabilities'),
      expect.stringContaining('Summarize changes daily'),
      expect.stringContaining('Fix reported bugs'),
    ]);
  });
});
