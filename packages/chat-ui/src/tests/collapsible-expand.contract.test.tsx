/**
 * collapsible-expand — browser regression tests.
 *
 * Verifies that toggling a collapsible row from collapsed → expanded actually
 * mounts the body content in the DOM.  This guards against the class of bug
 * where ProjectCollapsible or the Project dispatcher snapshot `props.node.layout`
 * non-reactively at mount time and never re-evaluate when the parent passes a
 * new Measured tree.
 */

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it } from 'vitest';
import { CachesContext } from '../components/CachesContext';
import { fileOpDef } from '../components/file-op/file-op.def';
import { Project } from '../components/Project';
import { ThemeContext } from '../components/ThemeContext';
import { thinkingDef } from '../components/thinking/thinking.def';
import { createChatCaches } from '../core/caches';
import { collapsible, slot } from '../core/compose';
import type { Measured, RenderCtx } from '../core/define';
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

// ── Project-level collapsible reactivity ─────────────────────────────────────

describe('Project collapsible reactivity', () => {
  it('mounts body slot after swap from collapsed to expanded', async () => {
    const collapsedNode = collapsible({
      headerH: 24,
      headerSlot: 'test:header',
      expanded: false,
    });
    const expandedNode = collapsible({
      headerH: 24,
      headerSlot: 'test:header',
      expanded: true,
      body: slot('test:body', 48),
    });

    const [node, setNode] = createSignal<Measured<any>>(collapsedNode);

    const { host, dispose } = mountTest(() => (
      <Project
        node={node()}
        slots={{
          'test:header': () => <div data-testid="header">Header</div>,
          'test:body': () => <div data-testid="body">Body content</div>,
        }}
      />
    ));

    await raf();

    // Body must NOT be in DOM when collapsed.
    expect(host.querySelector('[data-testid="body"]')).toBeNull();

    // Expand.
    setNode(expandedNode);
    await raf();

    // Body MUST be in DOM after expanding.
    expect(host.querySelector('[data-testid="body"]')).not.toBeNull();

    dispose();
  });

  it('hides body after swap from expanded back to collapsed', async () => {
    const collapsedNode = collapsible({ headerH: 24, headerSlot: 'h', expanded: false });
    const expandedNode = collapsible({
      headerH: 24,
      headerSlot: 'h',
      expanded: true,
      body: slot('b', 32),
    });

    const [node, setNode] = createSignal<Measured<any>>(expandedNode);

    const { host, dispose } = mountTest(() => (
      <Project
        node={node()}
        slots={{
          h: () => <div data-testid="header">H</div>,
          b: () => <div data-testid="body">B</div>,
        }}
      />
    ));

    await raf();
    expect(host.querySelector('[data-testid="body"]')).not.toBeNull();

    setNode(collapsedNode);
    await raf();
    expect(host.querySelector('[data-testid="body"]')).toBeNull();

    dispose();
  });
});

// ── thinkingDef expand via viewState ─────────────────────────────────────────

describe('thinkingDef expands body on viewState toggle', () => {
  it('renders prose body after isCollapsed flips to true (inverted: means expanded)', async () => {
    const item = {
      kind: 'thinking' as const,
      id: 'th-expand-test',
      status: 'done' as const,
      text: 'Analysis complete. The root cause is a missing null check.',
      startedAt: Date.now() - 5000,
      durationMs: 4800,
    };

    // Before expand: isCollapsed returns false (collapsed = not expanded in inverted mode).
    const [isCollapsedFlag, setIsCollapsedFlag] = createSignal(false);

    const ctx = {
      theme: DEFAULT_THEME,
      width: 640,
      isCollapsed: () => isCollapsedFlag(),
      expanded: (_id: string) => isCollapsedFlag(),
      caches: testCaches,
    };
    const renderCtx: RenderCtx = {
      viewState: { isCollapsed: (_id: string) => isCollapsedFlag() },
    };

    const collapsedLayout = thinkingDef.measure(item, {
      ...ctx,
      expanded: () => false,
      isCollapsed: () => false,
    });

    const expandedLayout = thinkingDef.measure(item, {
      ...ctx,
      expanded: () => true,
      isCollapsed: () => true,
    });

    const [layout, setLayout] = createSignal<Measured<any>>(collapsedLayout);
    const currentRenderCtx = () => renderCtx;

    const { host, dispose } = mountTest(() => {
      const Comp = thinkingDef.Render as (p: any) => any;
      return <Comp item={item} layout={layout()} ctx={currentRenderCtx()} />;
    });

    await raf();
    const heightBefore = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    // Expand: toggle flag + give a new layout (as Row would do).
    setIsCollapsedFlag(true);
    setLayout(expandedLayout);
    await raf();

    const heightAfter = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    // The expanded height must be strictly taller.
    expect(heightAfter).toBeGreaterThan(heightBefore);

    dispose();
  });
});

// ── fileOpDef expand via viewState ────────────────────────────────────────────

describe('fileOpDef expands list on viewState toggle', () => {
  it('renders file list rows after isCollapsed flips to true (inverted: means expanded)', async () => {
    const item = {
      kind: 'file-op' as const,
      id: 'fo-expand-test',
      op: 'read' as const,
      status: 'done' as const,
      ops: [{ path: 'src/a.ts' }, { path: 'src/b.ts' }, { path: 'src/c.ts' }],
    };

    const ctx = {
      theme: DEFAULT_THEME,
      width: 640,
      caches: testCaches,
    };

    const collapsedLayout = fileOpDef.measure(item, {
      ...ctx,
      isCollapsed: () => false,
      expanded: () => false,
    });
    const expandedLayout = fileOpDef.measure(item, {
      ...ctx,
      isCollapsed: () => true,
      expanded: () => true,
    });

    const [isCollapsedFlag, setIsCollapsedFlag] = createSignal(false);
    const [layout, setLayout] = createSignal<Measured<any>>(collapsedLayout);
    const renderCtx: RenderCtx = {
      viewState: { isCollapsed: (_id: string) => isCollapsedFlag() },
    };

    const { host, dispose } = mountTest(() => {
      const Comp = fileOpDef.Render as (p: any) => any;
      return <Comp item={item} layout={layout()} ctx={renderCtx} />;
    });

    await raf();
    const heightBefore = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    // Expand.
    setIsCollapsedFlag(true);
    setLayout(expandedLayout);
    await raf();

    const heightAfter = (host.firstElementChild as HTMLElement)?.offsetHeight ?? 0;

    // Expanded multi-file list must be taller than collapsed header.
    expect(heightAfter).toBeGreaterThan(heightBefore);

    dispose();
  });
});
