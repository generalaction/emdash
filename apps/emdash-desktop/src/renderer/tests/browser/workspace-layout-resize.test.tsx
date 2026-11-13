import '@emdash/ui/style.css';
import type { LayoutStorage } from '@emdash/ui/react/primitives';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { WorkspaceLayoutContextValue } from '@core/features/workbench/contributions/browser/layout-provider';
import { WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';

/**
 * Browser-mode tests for the workspace outer layout (#3316): the left sidebar
 * keeps the pixel width the user dragged it to, whatever the window does.
 * They run in real Chromium so the panel library measures real CSS layout
 * and gets real ResizeObserver callbacks when the host element (standing in
 * for the window, e.g. a tiling WM retiling the app) changes width, and
 * drags go through the library's own document-level pointer listeners.
 */

class MemoryStorage implements LayoutStorage {
  readonly map = new Map<string, string>();
  getItem = (key: string): string | null => this.map.get(key) ?? null;
  setItem = vi.fn((key: string, value: string): void => {
    this.map.set(key, value);
  });
}

const layoutContext = vi.hoisted(() => ({
  current: undefined as WorkspaceLayoutContextValue | undefined,
}));

vi.mock('@core/features/workbench/contributions/browser/layout-provider', () => ({
  useWorkspaceLayoutContext: () => layoutContext.current,
}));

const SIZE_KEY = 'collapsible-panel-size:workspace-outer:workspace-left';
// The percentage layout older builds persisted through `useDefaultLayout`.
const LEGACY_KEY = 'react-resizable-panels:workspace-outer:workspace-left:workspace-main';

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

  function render(): void {
    root.render(<WorkspaceLayout leftSidebar={<div />} mainContent={<div />} />);
  }

  async function mountAt(width: number): Promise<void> {
    host.style.width = `${width}px`;
    root = createRoot(host);
    await act(async () => render());
    await settle();
  }

  // Unmount + mount again stands in for an app restart.
  async function restartAt(width: number): Promise<void> {
    await unmount();
    await mountAt(width);
  }

  async function unmount(): Promise<void> {
    await act(async () => root.unmount());
  }

  async function setOpen(open: boolean): Promise<void> {
    layoutContext.current = { ...layoutContext.current!, isLeftOpen: open };
    await act(async () => render());
    await settle();
  }

  // Let ResizeObserver callbacks and the resulting layout re-render settle.
  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)));
    });
  }

  async function resizeWindow(width: number): Promise<void> {
    host.style.width = `${width}px`;
    await settle();
  }

  // A window resize in frame-sized steps, like a live resize or a tiling
  // WM's animation.
  async function animateWindow(from: number, to: number, steps = 12): Promise<void> {
    for (let step = 1; step <= steps; step++) {
      host.style.width = `${from + ((to - from) * step) / steps}px`;
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      });
    }
    await settle();
  }

  function separator(): HTMLElement {
    const element = host.querySelector<HTMLElement>('[data-separator]');
    if (!element) throw new Error('separator not rendered');
    return element;
  }

  function sidebarWidth(): number {
    return (
      host.querySelector<HTMLElement>('[data-panel][id^="workspace-left"]')?.getBoundingClientRect()
        .width ?? 0
    );
  }

  /** Drags the sidebar's separator to make the sidebar `px` wide. */
  async function dragSidebarTo(px: number): Promise<number> {
    const rect = separator().getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = px - sidebarWidth();
    const init = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse' };
    await act(async () => {
      separator().dispatchEvent(
        new PointerEvent('pointerdown', { ...init, clientX: x, clientY: y, buttons: 1 })
      );
      document.dispatchEvent(
        new PointerEvent('pointermove', { ...init, clientX: x + dx, clientY: y, buttons: 1 })
      );
      document.dispatchEvent(
        new PointerEvent('pointerup', { ...init, clientX: x + dx, clientY: y, buttons: 0 })
      );
    });
    await settle();
    return sidebarWidth();
  }

  async function pressOnSeparator(key: string): Promise<void> {
    await act(async () => {
      separator().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    });
    await settle();
  }

  beforeEach(() => {
    host = document.createElement('div');
    host.style.position = 'absolute';
    host.style.height = '600px';
    document.body.appendChild(host);
    storage = new MemoryStorage();
    // Like the real chrome store: the close command unmounts the panel.
    toggleLeftSidebar = vi.fn<() => void>(() => {
      layoutContext.current = {
        ...layoutContext.current!,
        isLeftOpen: !layoutContext.current!.isLeftOpen,
      };
      render();
    });
    layoutContext.current = {
      isLeftOpen: true,
      isZenActive: false,
      toggleLeftSidebar,
      toggleZenMode: vi.fn(),
      layoutStorage: storage,
    };
  });

  afterEach(async () => {
    await unmount();
    host.remove();
  });

  it('keeps the dragged pixel width when the window gets wider or narrower', async () => {
    await mountAt(1280);
    const dragged = await dragSidebarTo(300);
    expect(dragged).toBeCloseTo(300, 0);

    await resizeWindow(2560);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);

    await animateWindow(2560, 1100);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });

  it('keeps the default width in pixels, across window resizes and restarts', async () => {
    await mountAt(1280);
    const initial = sidebarWidth();

    await resizeWindow(2560);
    expect(sidebarWidth()).toBeCloseTo(initial, 0);

    await restartAt(1600);
    expect(sidebarWidth()).toBeCloseTo(initial, 0);
  });

  it('returns to the dragged width after the window was too narrow to fit it', async () => {
    await mountAt(1920);
    const dragged = await dragSidebarTo(380);

    // Half a 1920px screen: the 30% max clamps the sidebar to ~285px…
    await resizeWindow(950);
    expect(sidebarWidth()).toBeLessThan(dragged - 1);
    // …but the clamp is not a new width: full screen restores the dragged one.
    await resizeWindow(1920);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);

    // Same with frame-by-frame resizes, through a clamp-sized dip.
    await animateWindow(1920, 700);
    await animateWindow(700, 1920);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });

  it('restores the dragged pixel width after a restart at another window width', async () => {
    await mountAt(1280);
    const dragged = await dragSidebarTo(320);

    await restartAt(2560);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);

    // Restarting into a window too narrow to fit it clamps it but keeps the
    // width for the next wider window.
    await restartAt(900);
    expect(sidebarWidth()).toBeLessThan(dragged - 1);
    await resizeWindow(1600);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });

  it('reopens at the dragged pixel width after a window resize while closed', async () => {
    await mountAt(1280);
    const dragged = await dragSidebarTo(300);
    await setOpen(false);

    await resizeWindow(2560);
    await setOpen(true);

    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });

  it('persists user resizes only, never window resizes', async () => {
    await mountAt(1280);
    const dragged = await dragSidebarTo(300);
    expect(storage.map.get(SIZE_KEY)).toBe(`${Math.round(dragged)}px`);
    storage.setItem.mockClear();

    await resizeWindow(2560);
    await animateWindow(2560, 800);
    await resizeWindow(1280);

    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('persists drags and keyboard resizes at fractional window widths', async () => {
    // Zoomed windows have fractional CSS widths, and sub-pixel resizes do not
    // always reach the library as a layout change.
    await mountAt(1280.4);
    await resizeWindow(1600.7);
    await resizeWindow(1600.9);
    const dragged = await dragSidebarTo(330);
    expect(storage.map.get(SIZE_KEY)).toBe(`${Math.round(dragged)}px`);

    await resizeWindow(1440.3);
    await pressOnSeparator('ArrowRight');
    const pressed = sidebarWidth();
    expect(pressed).toBeGreaterThan(dragged + 10);
    expect(storage.map.get(SIZE_KEY)).toBe(`${Math.round(pressed)}px`);

    await restartAt(2000.6);
    expect(sidebarWidth()).toBeCloseTo(pressed, 0);
  });

  it('persists every drag at fractional window widths', async () => {
    // At fractional widths the panels' individually rounded sizes sum to
    // totals that depend on the split, and a sub-pixel window resize may not
    // reach the library as a layout change at all. Neither may make a drag
    // read as a window resize.
    await mountAt(1600.7);
    const targets = [300, 350.4, 262.8, 410.7, 333.3, 287.6, 377.1, 241.9];
    for (const [index, target] of targets.entries()) {
      if (index % 2 === 1) await resizeWindow(1600.7 + index * 0.1);
      const dragged = await dragSidebarTo(target);
      expect(storage.map.get(SIZE_KEY)).toBe(`${Math.round(dragged)}px`);
    }
  });

  it('keeps the size persisted by older builds, then stays in pixels', async () => {
    storage.map.set(LEGACY_KEY, JSON.stringify({ 'workspace-left': 25, 'workspace-main': 75 }));
    await mountAt(1280);
    expect(sidebarWidth()).toBeCloseTo(320, 0);

    await restartAt(2560);

    expect(sidebarWidth()).toBeCloseTo(320, 0);
  });

  it('never closes the sidebar because the window changed size', async () => {
    await mountAt(1280);
    // The 200px resize floor is below 8% of a 3200px window, and a 500px
    // window cannot fit it under the 30% max.
    const dragged = await dragSidebarTo(200);
    expect(dragged).toBeCloseTo(200, 0);

    await resizeWindow(3200);
    await resizeWindow(500);
    await resizeWindow(1280);

    expect(toggleLeftSidebar).not.toHaveBeenCalled();
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });

  it('keeps the sidebar open when a drag settles at its floor in a very wide window', async () => {
    await mountAt(3200);

    await dragSidebarTo(150);

    expect(toggleLeftSidebar).not.toHaveBeenCalled();
    expect(sidebarWidth()).toBeCloseTo(200, 0);
  });

  it('closes the sidebar when a drag goes well past its floor, then reopens at the last width', async () => {
    await mountAt(1280);
    const dragged = await dragSidebarTo(300);

    await dragSidebarTo(40);
    expect(toggleLeftSidebar).toHaveBeenCalledTimes(1);
    expect(sidebarWidth()).toBe(0);

    await setOpen(true);
    expect(sidebarWidth()).toBeCloseTo(dragged, 0);
  });
});
