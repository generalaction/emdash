import { JSDOM } from 'jsdom';
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskConfigPanel } from './task-config-panel';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('@renderer/lib/ui/panel-tabs', async () => {
  const React = await import('react');
  return {
    PanelTabs: ({
      value,
      onChange,
      tabs,
    }: {
      value: string;
      onChange: (value: string) => void;
      tabs: Array<{ value: string; label: string }>;
    }) =>
      React.createElement(
        'div',
        { 'data-active-tab': value },
        tabs.map((tab) =>
          React.createElement(
            'button',
            {
              key: tab.value,
              type: 'button',
              onClick: () => onChange(tab.value),
            },
            tab.label
          )
        )
      ),
  };
});

function StatefulContent({ label }: { label: string }) {
  const [value, setValue] = useState('initial');

  return (
    <button type="button" data-testid={label} onClick={() => setValue('edited')}>
      {value}
    </button>
  );
}

describe('TaskConfigPanel', () => {
  let dom: JSDOM;
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
      url: 'http://localhost',
    });
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Event', dom.window.Event);

    container = dom.window.document.getElementById('root') as HTMLDivElement;
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
    dom.window.close();
  });

  it('preserves tab content state when switching tabs', async () => {
    await act(async () => {
      root.render(
        <TaskConfigPanel
          preserveTabContent
          tabs={[
            {
              value: 'conversation',
              label: 'Initial Conversation',
              content: <StatefulContent label="conversation" />,
            },
            {
              value: 'workspace',
              label: 'Workspace Settings',
              content: <div>Workspace</div>,
            },
          ]}
        />
      );
    });

    const conversationButton = container.querySelector('[data-testid="conversation"]');
    expect(conversationButton?.textContent).toBe('initial');

    await act(async () => {
      conversationButton?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(conversationButton?.textContent).toBe('edited');

    await act(async () => {
      container
        .querySelector('button:nth-of-type(2)')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      container
        .querySelector('button:nth-of-type(1)')
        ?.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    expect(container.querySelector('[data-testid="conversation"]')?.textContent).toBe('edited');
  });
});
