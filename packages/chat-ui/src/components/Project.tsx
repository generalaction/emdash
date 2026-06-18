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
 */

import { For, Show, createEffect, onCleanup, type JSX } from 'solid-js';
import type { Block, CodeBlock, ProseBlock } from '../core/blocks/block-types';
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
export type ProseLeafLayout = ProseLaidOut & { kind: 'prose'; raw: ProseBlock };
export type CodeLeafLayout = CodeLaidOut & { kind: 'code'; raw: CodeBlock };
export type TableLeafLayout = TableLaidOut & { kind: 'table'; raw: Block };

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
  const { padX, padY, border, child } = props.node.layout;
  return (
    <div
      style={{
        position: 'relative',
        height: `${props.node.height}px`,
        'box-sizing': 'border-box',
        'border-width': `${border}px`,
        'padding-top': `${padY}px`,
        'padding-bottom': `${padY}px`,
        'padding-left': `${padX}px`,
        'padding-right': `${padX}px`,
      }}
    >
      {props.render(child)}
    </div>
  );
}

function ProjectBubble(props: {
  node: Measured<BubbleLayout>;
  render: (child: Measured) => JSX.Element;
}) {
  const { padX, child, variantClass, width } = props.node.layout;
  return (
    <div
      class={variantClass}
      style={{
        position: 'relative',
        height: `${props.node.height}px`,
        'padding-left': `${padX}px`,
        'padding-right': `${padX}px`,
        ...(width !== undefined ? { width: `${width}px` } : {}),
      }}
    >
      {props.render(child)}
    </div>
  );
}

function ProjectCollapsible(props: {
  node: Measured<CollapsibleLayout>;
  slots: Record<string, (node: Measured<SlotLayout>) => JSX.Element>;
  render: (child: Measured) => JSX.Element;
}) {
  const { headerH, bodyTop, expanded, child, headerSlot } = props.node.layout;
  const headerSlotNode: Measured<SlotLayout> = {
    height: headerH,
    width: props.node.width,
    layout: { kind: 'slot', name: headerSlot, height: headerH },
  };
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px` }}>
      <div style={{ position: 'absolute', top: '0', left: 0, right: 0, height: `${headerH}px` }}>
        {props.slots[headerSlot]?.(headerSlotNode)}
      </div>
      <Show when={expanded && child}>
        {(c) => (
          <div
            style={{
              position: 'absolute',
              top: `${bodyTop}px`,
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
  const { maxH, child, overlay, autoScrollBottom } = props.node.layout;
  let scrollEl: HTMLDivElement | undefined;

  // Auto-scroll to bottom when the child height changes (active thinking preview).
  if (autoScrollBottom) {
    createEffect(() => {
      const _h = child.height; // track height reactively
      if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
      return _h;
    });
    onCleanup(() => {
      scrollEl = undefined;
    });
  }

  const fadeClass =
    overlay === 'fade-top'
      ? 'fade-overlay-top pointer-events-none absolute inset-x-0 top-0 z-10'
      : overlay === 'fade-bottom'
        ? 'fade-overlay-bottom pointer-events-none absolute inset-x-0 bottom-0 z-10'
        : '';

  return (
    <div
      style={{
        height: `${props.node.height}px`,
        'max-height': `${maxH}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {overlay && <div class={fadeClass} style={{ height: '28px' }} aria-hidden="true" />}
      <div
        ref={(el) => {
          scrollEl = el;
        }}
        style={{
          'max-height': `${maxH}px`,
          overflow: autoScrollBottom ? 'auto' : 'hidden',
          'scrollbar-gutter': autoScrollBottom ? 'stable' : undefined,
        }}
      >
        {props.render(child)}
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
 */
export function Project(props: ProjectProps): JSX.Element {
  const layout = props.node.layout as AnyLayout;
  const slots = props.slots ?? {};
  const renderLeaf = props.children ?? renderBlockLeaf;

  // oxlint-disable-next-line typescript/no-explicit-any -- tree walk; each branch narrows the type
  const renderChild = (child: Measured<any>): JSX.Element => (
    <Project node={child} slots={slots}>
      {renderLeaf}
    </Project>
  );

  switch (layout.kind) {
    case 'stack':
      return <ProjectStack node={props.node as Measured<StackLayout>} render={renderChild} />;
    case 'pad':
      return <ProjectPad node={props.node as Measured<PadLayout>} render={renderChild} />;
    case 'bubble':
      return <ProjectBubble node={props.node as Measured<BubbleLayout>} render={renderChild} />;
    case 'collapsible':
      return (
        <ProjectCollapsible
          node={props.node as Measured<CollapsibleLayout>}
          slots={slots}
          render={renderChild}
        />
      );
    case 'window':
      return <ProjectWindow node={props.node as Measured<WindowLayout>} render={renderChild} />;
    case 'slot': {
      const slotLayout = layout as SlotLayout;
      return slots[slotLayout.name]?.(props.node as Measured<SlotLayout>) ?? null;
    }
    default:
      return renderLeaf(props.node) ?? null;
  }
}
