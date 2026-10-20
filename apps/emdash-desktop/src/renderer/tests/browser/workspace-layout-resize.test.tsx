import '@emdash/ui/style.css';
import type { LayoutStorage } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkspaceLayoutContextValue } from '@core/features/workbench/contributions/browser/layout-provider';
import { WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';

/**
 * Browser-mode tests for the workspace outer layout. They run in real
 * Chromium so the panel library measures real CSS layout and gets real
 * ResizeObserver callbacks when the window (here: the host element) changes
 * width, like a tiling window manager resizing the app.
 */

class MemoryStorage implements LayoutStorage {
  readonly map = new Map<string, string>();
  getItem = (key: string): string | null => this.map.get(key) ?? null;
  setItem = (key: string, value: string): void => {
    this.map.set(key, value);
  };
}

const layoutContext = vi.hoisted(() => ({
  current: undefined as WorkspaceLayoutContextValue | undefined,
}));

vi.mock('@core/features/workbench/contributions/browser/layout-provider', () => ({
  useWorkspaceLayoutContext: () => layoutContext.current,
}));

// `useDefaultLayout` storage key for the workspace outer group.
const STORAGE_KEY = 'react-resizable-panels:workspace-outer:workspace-left:workspace-main';

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

describe('WorkspaceLayout window resize', () => {
  let host: HTMLDivElement;
  let root: Root;
  let storage: MemoryStorage;
  let toggleLeftSidebar: Mock<() => void>;

  async function renderAt(width: number): Promise<void> {
    host.style.width = `${width}px`;
    await act(async () => {
      root.render(<WorkspaceLayout leftSidebar={<div />} mainContent={<div />} />);
    });
    await expect.poll(sidebarWidth).toBeGreaterThan(0);
  }

  async function resizeWindow(width: number): Promise<void> {
    await act(async () => {
      host.style.width = `${width}px`;
      // Let the ResizeObserver callback and the layout re-render settle.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
  }

  function sidebarWidth(): number {
    return document.getElementById('workspace-left')?.getBoundingClientRect().width ?? 0;
  }

  beforeEach(() => {
    host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.height = '600px';
    document.body.appendChild(host);
    root = createRoot(host);
    storage = new MemoryStorage();
    toggleLeftSidebar = vi.fn<() => void>();
    layoutContext.current = {
      isLeftOpen: true,
      isZenActive: false,
      toggleLeftSidebar,
      toggleZenMode: vi.fn(),
      layoutStorage: storage,
    };
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
  });

  it('keeps the sidebar pixel width when the window gets wider', async () => {
    await renderAt(1280);
    const before = sidebarWidth();

    await resizeWindow(2560);

    await expect.poll(sidebarWidth).toBeCloseTo(before, 0);
  });

  it('keeps the sidebar pixel width when the window gets narrower', async () => {
    await renderAt(1600);
    const before = sidebarWidth();

    await resizeWindow(1280);

    await expect.poll(sidebarWidth).toBeCloseTo(before, 0);
  });

  it('keeps a sidebar at its minimum width open when the window gets very wide', async () => {
    // A 200px sidebar (the resize floor) in a 1280px window.
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({ 'workspace-left': 15.625, 'workspace-main': 84.375 })
    );
    await renderAt(1280);
    const before = sidebarWidth();

    // 200px is less than 8% of this width.
    await resizeWindow(3200);

    await expect.poll(sidebarWidth).toBeCloseTo(before, 0);
    expect(toggleLeftSidebar).not.toHaveBeenCalled();
  });
});
