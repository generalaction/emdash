import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TabProvider } from './core/tab-provider';
import { createTabRegistry } from './core/tab-provider-registry';
import { PaneContent } from './pane-content';
import { PaneContext } from './pane-context';
import { PaneStore } from './pane-store';

function createTestProvider(kind: 'editor' | 'textarea'): TabProvider {
  return {
    kind,
    resourceKey: () => kind,
    initialize: () => ({ dispose() {} }),
    dispose: (_entry, resource) => resource.dispose(),
    TabBarItem: ({ tab, host }) => (
      <button data-tabid={tab.tabId} onClick={() => host.setActiveTab(tab.tabId)}>
        {kind}
      </button>
    ),
    TabBarItemDragPreview: () => null,
    TabContent: () => (
      <div
        data-scroll={kind}
        style={{
          position: 'fixed',
          top: 100,
          left: 0,
          width: 400,
          height: 200,
          overflow: 'auto',
        }}
      >
        <div style={{ width: 2000, height: 2000 }}>
          {kind === 'editor' ? <div contentEditable /> : <textarea />}
        </div>
      </div>
    ),
  };
}

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('PaneContent focus restoration', () => {
  let host: HTMLDivElement;
  let root: Root;
  let pane: PaneStore;

  beforeEach(async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    pane = new PaneStore(
      createTabRegistry([createTestProvider('editor'), createTestProvider('textarea')]),
      { viewId: 'test-view' }
    );
    pane.open('editor', {});
    pane.open('textarea', {});

    await act(async () => {
      root.render(
        <PaneContext.Provider
          value={{ paneId: 'test-pane', pane, scopeInstance: undefined, isFocusedPane: true }}
        >
          <PaneContent />
        </PaneContext.Provider>
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    pane.dispose();
    host.remove();
  });

  it.each(['editor', 'textarea'] as const)(
    'restores %s focus after switching away and back without moving either viewport',
    async (kind) => {
      const targetTab = pane.resolvedTabs.find((tab) => tab.kind === kind)!;
      const otherTab = pane.resolvedTabs.find((tab) => tab.kind !== kind)!;
      const viewport = host.querySelector<HTMLElement>(`[data-scroll="${kind}"]`)!;
      const otherViewport = host.querySelector<HTMLElement>(`[data-scroll="${otherTab.kind}"]`)!;
      const editor = viewport.querySelector<HTMLElement>('textarea, [contenteditable="true"]')!;

      async function selectTab(tabId: string): Promise<void> {
        const button = host.querySelector<HTMLButtonElement>(`[data-tabid="${tabId}"]`)!;
        await act(async () => {
          button.focus();
          button.click();
        });
        // PaneStore defers content focus until the selected tab has rendered.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      }

      await selectTab(targetTab.tabId);
      viewport.scrollTop = 1500;
      viewport.scrollLeft = 750;
      expect([viewport.scrollTop, viewport.scrollLeft]).toEqual([1500, 750]);

      await selectTab(otherTab.tabId);
      expect(document.activeElement).not.toBe(editor);
      otherViewport.scrollTop = 1200;
      otherViewport.scrollLeft = 500;

      await selectTab(targetTab.tabId);

      expect(document.activeElement).toBe(editor);
      expect([viewport.scrollTop, viewport.scrollLeft]).toEqual([1500, 750]);
      expect([otherViewport.scrollTop, otherViewport.scrollLeft]).toEqual([1200, 500]);
    }
  );
});
