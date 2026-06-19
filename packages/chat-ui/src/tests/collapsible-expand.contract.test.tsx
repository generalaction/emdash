/**
 * collapsible-expand — browser regression tests.
 *
 * Verifies that toggling a collapsible unit from collapsed → expanded changes
 * the rendered height. Guards against stale-closure or memo bugs where the
 * Render component doesn't react to viewState changes.
 */

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { CachesContext } from '../components/CachesContext';
import { fileOpUnitDef } from '../components/file-op/file-op.def';
import { ThemeContext } from '../components/ThemeContext';
import { thinkingUnitDef } from '../components/thinking/thinking.def';
import { createChatCaches } from '../core/caches';
import type { MeasureCtx, RenderCtx } from '../core/define';
import { DEFAULT_THEME } from '../core/theme';

const testCaches = createChatCaches();

// ── Mount helper ──────────────────────────────────────────────────────────────

const hosts: HTMLElement[] = [];

function mountTest(renderFn: () => any): { host: HTMLElement; dispose: () => void } {
  const host = document.createElement('div');
  host.style.width = '640px';
  document.body.appendChild(host);
  hosts.push(host);
  const dispose = render(
    () => (
      <ThemeContext.Provider value={() => DEFAULT_THEME}>
        <CachesContext.Provider value={testCaches}>{renderFn()}</CachesContext.Provider>
      </ThemeContext.Provider>
    ),
    host
  );
  return { host, dispose };
}

afterEach(() => {
  while (hosts.length > 0) {
    hosts.pop()?.remove();
  }
});

const raf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

// ── thinkingUnitDef expand via viewState ─────────────────────────────────────

describe('thinkingUnitDef expands body on viewState toggle', () => {
  it('renders taller after isCollapsed flips to true (inverted: means expanded)', async () => {
    const item = {
      kind: 'thinking' as const,
      id: 'th-expand-test',
      status: 'done' as const,
      text: 'Analysis complete. The root cause is a missing null check.',
      startedAt: Date.now() - 5000,
      durationMs: 4800,
    };

    const [isCollapsedFlag, setIsCollapsedFlag] = createSignal(false);

    const measureCtx: MeasureCtx = {
      theme: DEFAULT_THEME,
      width: 640,
      isCollapsed: () => isCollapsedFlag(),
      expanded: () => isCollapsedFlag(),
      caches: testCaches,
    };

    const renderCtx = (): RenderCtx => ({
      viewState: { isCollapsed: (_id: string) => isCollapsedFlag() },
      measureCtx: () => measureCtx,
    });

    const { host, dispose } = mountTest(() => (
      <thinkingUnitDef.Render data={item} ctx={renderCtx()} />
    ));

    await raf();
    const heightBefore = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    setIsCollapsedFlag(true);
    await raf();

    const heightAfter = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;
    expect(heightAfter).toBeGreaterThan(heightBefore);

    dispose();
  });
});

// ── fileOpUnitDef expand via viewState ────────────────────────────────────────

describe('fileOpUnitDef expands list on viewState toggle', () => {
  it('renders taller after isCollapsed flips to true (inverted: means expanded)', async () => {
    const item = {
      kind: 'file-op' as const,
      id: 'fo-expand-test',
      op: 'read' as const,
      status: 'done' as const,
      ops: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }],
    };

    const [isCollapsedFlag, setIsCollapsedFlag] = createSignal(false);

    const measureCtx: MeasureCtx = {
      theme: DEFAULT_THEME,
      width: 640,
      isCollapsed: () => isCollapsedFlag(),
      expanded: () => isCollapsedFlag(),
      caches: testCaches,
    };

    const renderCtx = (): RenderCtx => ({
      viewState: { isCollapsed: (_id: string) => isCollapsedFlag() },
      measureCtx: () => measureCtx,
    });

    const { host, dispose } = mountTest(() => (
      <fileOpUnitDef.Render data={item} ctx={renderCtx()} />
    ));

    await raf();
    const heightBefore = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    setIsCollapsedFlag(true);
    await raf();

    const heightAfter = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;
    expect(heightAfter).toBeGreaterThan(heightBefore);

    dispose();
  });
});
