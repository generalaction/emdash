/**
 * Project — generic layout tree renderer.
 *
 * Walks a `Measured` tree by `layout.kind` and renders each node using full
 * projection (all geometry from the layout, no CSS-driven geometry).
 *
 * Combinator nodes (stack / pad / bubble / collapsible / window) are handled
 * recursively.  Slot nodes are dispatched to the `slots` map supplied by the
 * calling Render shell.  All other `layout.kind` values are treated as generic
 * block leaves and dispatched to `children`.
 *
 * Leaf layouts produced by `core/layout/block-stack.ts` carry a `raw`
 * back-reference to the source `Block`; `renderBlockLeaf` uses this to
 * construct `Prose`/`Code`/`Table` without a separate block lookup.
 *
 * Reactivity note: all sub-renderers read `props.node.layout` through an
 * accessor function rather than destructuring at the call site.  This ensures
 * that when a parent re-measures and passes a new Measured object with a
 * different layout value (e.g. collapsible toggling expanded/collapsed), the
 * JSX expressions inside each sub-renderer re-evaluate correctly.
 */

import { For, Match, Show, Switch, createEffect, onCleanup, type JSX } from 'solid-js';
import type { Block, CodeBlock, ProseBlock } from '../core/markdown/document';
import type {
  BubbleLayout,
  CollapsibleLayout,
  PadLayout,
  SlotLayout,
  StackLayout,
  WindowLayout,
} from '../core/compose';
import type { Measured } from '../core/define';
import type { CodeLaidOut, ProseLaidOut, TableLaidOut } from '../core/layout/layout-types';
import { Code } from './code/Code';
import { Prose } from './prose/Prose';
import { Table } from './table/Table';

// ── Type discriminator ────────────────────────────────────────────────────────

type AnyLayout = { kind: string };

// ── Block leaf layout (produced by block-stack.ts) ────────────────────────────

/**
 * Extended leaf layout types that carry a back-reference to the source Block.
 * Produced by `measureBlockCached` in `core/layout/block-stack.ts`.
 */
export type ProseLeafLayout = ProseLaidOut & { raw: ProseBlock };
export type CodeLeafLayout = CodeLaidOut & { raw: CodeBlock };
export type TableLeafLayout = TableLaidOut & { raw: Block };

export type BlockLeafLayout = ProseLeafLayout | CodeLeafLayout | TableLeafLayout;

// ── Sub-renderers ─────────────────────────────────────────────────────────────

function ProjectStack(props: {
  node: Measured<StackLayout>;
  render: (child: Measured) => JSX.Element;
}) {
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px`, width: '100%' }}>
      <For each={props.node.layout.placed}>
        {(placed) => (
          <div
            style={{
              position: 'absolute',
              top: `${placed.top}px`,
              left: 0,
              right: 0,
              height: `${placed.child.height}px`,
            }}
          >
            {props.render(placed.child)}
          </div>
        )}
      </For>
    </div>
  );
}

function ProjectPad(props: {
  node: Measured<PadLayout>;
  render: (child: Measured) => JSX.Element;
}) {
  const l = () => props.node.layout;
  return (
    <div
      style={{
        position: 'relative',
        height: `${props.node.height}px`,
        'box-sizing': 'border-box',
        'border-width': `${l().border}px`,
        'padding-top': `${l().padY}px`,
        'padding-bottom': `${l().padY}px`,
        'padding-left': `${l().padX}px`,
        'padding-right': `${l().padX}px`,
      }}
    >
      {props.render(l().child)}
    </div>
  );
}

function ProjectBubble(props: {
  node: Measured<BubbleLayout>;
  render: (child: Measured) => JSX.Element;
}) {
  const l = () => props.node.layout;
  return (
    <div
      class={l().variantClass}
      style={{
        position: 'relative',
        height: `${props.node.height}px`,
        'padding-left': `${l().padX}px`,
        'padding-right': `${l().padX}px`,
        ...(l().width !== undefined ? { width: `${l().width}px` } : {}),
      }}
    >
      {props.render(l().child)}
    </div>
  );
}

function ProjectCollapsible(props: {
  node: Measured<CollapsibleLayout>;
  slots: Record<string, (node: Measured<SlotLayout>) => JSX.Element>;
  render: (child: Measured) => JSX.Element;
}) {
  const l = () => props.node.layout;
  const headerSlotNode = (): Measured<SlotLayout> => ({
    height: l().headerH,
    width: props.node.width,
    layout: { kind: 'slot', name: l().headerSlot, height: l().headerH },
  });
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px` }}>
      <div style={{ position: 'absolute', top: '0', left: 0, right: 0, height: `${l().headerH}px` }}>
        {props.slots[l().headerSlot]?.(headerSlotNode())}
      </div>
      <Show when={l().expanded && l().child}>
        {(c) => (
          <div
            style={{
              position: 'absolute',
              top: `${l().bodyTop}px`,
              left: 0,
              right: 0,
              height: `${c().height}px`,
            }}
          >
            {props.render(c())}
          </div>
        )}
      </Show>
    </div>
  );
}

function ProjectWindow(props: {
  node: Measured<WindowLayout>;
  render: (child: Measured) => JSX.Element;
}) {
  const l = () => props.node.layout;
  let scrollEl: HTMLDivElement | undefined;

  // Auto-scroll to bottom when autoScrollBottom is enabled.
  // The effect is registered unconditionally so it runs whenever l().child.height
  // changes (active thinking/file-op preview auto-scrolls as content grows).
  createEffect(() => {
    if (!l().autoScrollBottom) return;
    const _h = l().child.height; // track height reactively
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    return _h;
  });
  onCleanup(() => {
    scrollEl = undefined;
  });

  return (
    <div
      style={{
        height: `${props.node.height}px`,
        'max-height': `${l().maxH}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <Show when={l().overlay}>
        <div
          class={
            l().overlay === 'fade-top'
              ? 'fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10'
              : 'fade-overlay-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10'
          }
          style={{ height: '28px' }}
          aria-hidden="true"
        />
      </Show>
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        style={{
          'max-height': `${l().maxH}px`,
          overflow: l().autoScrollBottom ? 'auto' : 'hidden',
          'scrollbar-gutter': l().autoScrollBottom ? 'stable' : undefined,
        }}
      >
        {props.render(l().child)}
      </div>
    </div>
  );
}

// ── Block leaf renderer ───────────────────────────────────────────────────────

/**
 * Render a generic block leaf node produced by `layoutBlockStack`.
 *
 * The layout carries a `raw` back-reference to the source `Block` so
 * Prose/Code/Table renderers can access `runs`, `variant`, and code text
 * without a separate lookup.  This replaces `BlockStack.tsx`.
 */
export function renderBlockLeaf(node: Measured): JSX.Element {
  const layout = node.layout as AnyLayout;
  if (layout.kind === 'prose') {
    const l = node.layout as ProseLeafLayout;
    return <Prose block={l} runs={l.raw.runs} variant={l.raw.variant} />;
  }
  if (layout.kind === 'code') {
    const l = node.layout as CodeLeafLayout;
    return <Code block={l} rawBlock={l.raw} />;
  }
  if (layout.kind === 'table') {
    const l = node.layout as TableLeafLayout;
    return <Table block={l as TableLaidOut} />;
  }
  return null;
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export type ProjectProps = {
  // oxlint-disable-next-line typescript/no-explicit-any -- accepts any layout tree node
  node: Measured<any>;
  /**
   * Map from slot name to render function.  Consulted for `slot` nodes and
   * for `collapsible` header slots.
   */
  slots?: Record<string, (node: Measured<SlotLayout>) => JSX.Element>;
  /**
   * Renderer for non-combinator leaf nodes (prose/code/table block leaves).
   * Defaults to `renderBlockLeaf`.  Callers may override for custom leaves.
   */
  children?: (child: Measured) => JSX.Element;
};

/**
 * Render a `Measured` layout tree by `layout.kind`.
 *
 * Combinator nodes (stack / pad / bubble / collapsible / window) are rendered
 * recursively.  Slot nodes are resolved via `props.slots`.  All other kinds
 * are treated as block leaves and rendered via `renderBlockLeaf` (or the
 * `children` override).
 *
 * The `layout.kind` accessor drives a reactive `<Switch>` so that when a
 * parent passes a re-measured node with a different kind (e.g. file-op going
 * from `slot` to `collapsible` as ops stream in), the correct branch mounts.
 */
export function Project(props: ProjectProps): JSX.Element {
  const layout = () => props.node.layout as AnyLayout;
  const slots = props.slots ?? {};
  const renderLeaf = props.children ?? renderBlockLeaf;

  // oxlint-disable-next-line typescript/no-explicit-any -- tree walk; each branch narrows the type
  const renderChild = (child: Measured<any>): JSX.Element => (
    <Project node={child} slots={slots}>
      {renderLeaf}
    </Project>
  );

  return (
    <Switch fallback={renderLeaf(props.node) ?? null}>
      <Match when={layout().kind === 'stack'}>
        <ProjectStack node={props.node as Measured<StackLayout>} render={renderChild} />
      </Match>
      <Match when={layout().kind === 'pad'}>
        <ProjectPad node={props.node as Measured<PadLayout>} render={renderChild} />
      </Match>
      <Match when={layout().kind === 'bubble'}>
        <ProjectBubble node={props.node as Measured<BubbleLayout>} render={renderChild} />
      </Match>
      <Match when={layout().kind === 'collapsible'}>
        <ProjectCollapsible
          node={props.node as Measured<CollapsibleLayout>}
          slots={slots}
          render={renderChild}
        />
      </Match>
      <Match when={layout().kind === 'window'}>
        <ProjectWindow node={props.node as Measured<WindowLayout>} render={renderChild} />
      </Match>
      <Match when={layout().kind === 'slot'}>
        {slots[(layout() as SlotLayout).name]?.(props.node as Measured<SlotLayout>) ?? null}
      </Match>
    </Switch>
  );
}
