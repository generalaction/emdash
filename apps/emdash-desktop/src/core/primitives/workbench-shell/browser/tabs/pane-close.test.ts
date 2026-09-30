import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TabHandle } from './core/tab-provider';
import { createTabRegistry } from './core/tab-provider-registry';
import { PaneStore } from './pane-store';

const panes: PaneStore[] = [];

afterEach(() => {
  for (const pane of panes.splice(0)) pane.dispose();
});

function setup(onBeforeClose?: () => boolean | Promise<boolean>) {
  const resources: Array<{ onClose: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> =
    [];
  const handles: TabHandle[] = [];
  const registry = createTabRegistry([
    {
      kind: 'test',
      resourceKey: (state: { id: string }) => state.id,
      initialize: (_entry, handle: TabHandle) => {
        const resource = { onClose: vi.fn(), dispose: vi.fn() };
        resources.push(resource);
        handles.push(handle);
        return resource;
      },
      onBeforeClose,
      dispose() {},
      TabBarItem: () => null,
      TabBarItemDragPreview: () => null,
      TabContent: () => null,
    },
  ]);
  const pane = new PaneStore(registry, { viewId: 'test-view' });
  panes.push(pane);
  pane.open('test', { id: 'first' });
  const tabId = pane.activeTabId;
  if (!tabId) throw new Error('Missing test tab');
  return { pane, resources, handles, tabId };
}

describe('user close lifecycle', () => {
  it('calls onClose once after removing a user-closed tab', () => {
    const { pane, resources, tabId } = setup();
    resources[0].onClose.mockImplementation(() => expect(pane.entries.has(tabId)).toBe(false));
    pane.requestCloseTab(tabId);
    pane.requestCloseTab(tabId);
    expect(resources[0].onClose).toHaveBeenCalledOnce();
    expect(resources[0].dispose).toHaveBeenCalledOnce();
  });

  it('acknowledges tabs explicitly closed through close others', () => {
    const { pane, resources } = setup();
    pane.open('test', { id: 'second' });
    const second = pane.activeTabId;
    if (!second) throw new Error('Missing second tab');
    pane.closeOthers(second);
    expect(resources[0].onClose).toHaveBeenCalledOnce();
    expect(resources[1].onClose).not.toHaveBeenCalled();
  });

  it.each([false, true])('waits for the close veto result: %s', async (proceed) => {
    let confirm: (value: boolean) => void = () => {};
    const confirmation = new Promise<boolean>((resolve) => {
      confirm = resolve;
    });
    const { pane, resources, tabId } = setup(() => confirmation);
    pane.requestCloseTab(tabId);
    expect(resources[0].onClose).not.toHaveBeenCalled();
    expect(resources[0].dispose).not.toHaveBeenCalled();
    confirm(proceed);
    await confirmation;
    expect(resources[0].onClose).toHaveBeenCalledTimes(proceed ? 1 : 0);
    expect(pane.entries.has(tabId)).toBe(!proceed);
  });

  it('does not close or acknowledge a replacement after an older confirmation resolves', async () => {
    let confirm: (value: boolean) => void = () => {};
    const confirmation = new Promise<boolean>((resolve) => {
      confirm = resolve;
    });
    const { pane, resources, tabId } = setup(() => confirmation);
    pane.requestCloseTab(tabId);
    pane.retargetEntry(tabId, { state: { id: 'replacement' } });
    confirm(true);
    await confirmation;
    expect(pane.entries.has(tabId)).toBe(true);
    for (const resource of resources) expect(resource.onClose).not.toHaveBeenCalled();
  });

  it.each(['force', 'handle', 'forced handle'] as const)(
    'does not acknowledge a programmatic close through %s',
    async (operation) => {
      const { pane, resources, handles, tabId } = setup();
      if (operation === 'force') pane.closeTab(tabId);
      else await handles[0].close({ force: operation === 'forced handle' });
      expect(resources[0].onClose).not.toHaveBeenCalled();
      expect(resources[0].dispose).toHaveBeenCalledOnce();
    }
  );
});
