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
 * Performance design:
 *   - Dispatch: one `createMemo` over `layout.kind` feeds `<Dynamic>`.
 *     This replaces the previous `<Switch>+6<Match>` (which created many
 *     reactive scopes per node) and an eagerly-evaluated `fallback`.
 *     The leaf/slot fast-path also skips all 6 condition checks.
 *   - Styles: each sub-renderer batches all `l()`-derived style properties
 *     into a single `createMemo` so Solid tracks one computation rather than
 *     N per-property reactive bindings.
 *   - Reactivity for correctness: `l() = () => props.node.layout` ensures that
 *     when a parent passes a new `Measured` node (e.g. collapsible toggling
 *     expanded/collapsed), all JSX expressions re-evaluate correctly.
 */

import { For, Show, createEffect, createMemo, onCleanup, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
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

// ── Uniform sub-renderer prop type ────────────────────────────────────────────

/**
 * Prop shape shared by every sub-renderer component so they can all be stored
 * in a single `Record<string, Component>` and dispatched via `<Dynamic>`.
 * Sub-renderers that do not use `slots` / `renderLeaf` simply ignore them.
 */
type SubProps = {
  // oxlint-disable-next-line typescript/no-explicit-any -- dispatch boundary; each renderer narrows at its own call site
  node: Measured<any>;
  slots: Record<string, (n: Measured<SlotLayout>) => JSX.Element>;
  // oxlint-disable-next-line typescript/no-explicit-any
  render: (child: Measured<any>) => JSX.Element;
  renderLeaf: (node: Measured) => JSX.Element;
};

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

function ProjectStack(props: SubProps) {
  const placed = () => (props.node as Measured<StackLayout>).layout.placed;
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px`, width: '100%' }}>
      <For each={placed()}>
        {(p) => (
          <div
            style={{
              position: 'absolute',
              top: `${p.top}px`,
              left: 0,
              right: 0,
              height: `${p.child.height}px`,
            }}
          >
            {props.render(p.child)}
          </div>
        )}
      </For>
    </div>
  );
}

function ProjectPad(props: SubProps) {
  const l = () => (props.node as Measured<PadLayout>).layout;
  const style = createMemo(() => ({
    position: 'relative' as const,
    height: `${props.node.height}px`,
    'box-sizing': 'border-box' as const,
    'border-width': `${l().border}px`,
    'padding-top': `${l().padY}px`,
    'padding-bottom': `${l().padY}px`,
    'padding-left': `${l().padX}px`,
    'padding-right': `${l().padX}px`,
  }));
  return <div style={style()}>{props.render(l().child)}</div>;
}

function ProjectBubble(props: SubProps) {
  const l = () => (props.node as Measured<BubbleLayout>).layout;
  const style = createMemo(() => ({
    position: 'relative' as const,
    height: `${props.node.height}px`,
    'padding-left': `${l().padX}px`,
    'padding-right': `${l().padX}px`,
    ...(l().width !== undefined ? { width: `${l().width}px` } : {}),
  }));
  return (
    <div class={l().variantClass} style={style()}>
      {props.render(l().child)}
    </div>
  );
}

function ProjectCollapsible(props: SubProps) {
  const l = () => (props.node as Measured<CollapsibleLayout>).layout;
  const headerSlotNode = (): Measured<SlotLayout> => ({
    height: l().headerH,
    width: props.node.width,
    layout: { kind: 'slot', name: l().headerSlot, height: l().headerH },
  });
  const outerStyle = createMemo(() => ({
    position: 'relative' as const,
    height: `${props.node.height}px`,
  }));
  const headerStyle = createMemo(() => ({
    position: 'absolute' as const,
    top: '0',
    left: '0',
    right: '0',
    height: `${l().headerH}px`,
  }));
  const bodyStyle = createMemo(() => ({
    position: 'absolute' as const,
    top: `${l().bodyTop}px`,
    left: '0',
    right: '0',
  }));
  return (
    <div style={outerStyle()}>
      <div style={headerStyle()}>{props.slots[l().headerSlot]?.(headerSlotNode())}</div>
      <Show when={l().expanded && l().child}>
        {(c) => (
          <div style={{ ...bodyStyle(), height: `${c().height}px` }}>{props.render(c())}</div>
        )}
      </Show>
    </div>
  );
}

function ProjectWindow(props: SubProps) {
  const l = () => (props.node as Measured<WindowLayout>).layout;
  let scrollEl: HTMLDivElement | undefined;

  // Auto-scroll to bottom when autoScrollBottom is enabled.
  // Runs unconditionally so Solid tracks l().child.height reactively as
  // content grows during active thinking/file-op preview streaming.
  createEffect(() => {
    if (!l().autoScrollBottom) return;
    const _h = l().child.height;
    if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
    return _h;
  });
  onCleanup(() => {
    scrollEl = undefined;
  });

  const outerStyle = createMemo(() => ({
    height: `${props.node.height}px`,
    'max-height': `${l().maxH}px`,
    overflow: 'hidden' as const,
    position: 'relative' as const,
  }));
  const scrollStyle = createMemo(() => ({
    'max-height': `${l().maxH}px`,
    overflow: l().autoScrollBottom ? 'auto' : ('hidden' as const),
    'scrollbar-gutter': l().autoScrollBottom ? ('stable' as const) : undefined,
  }));

  return (
    <div style={outerStyle()}>
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
        style={scrollStyle()}
      >
        {props.render(l().child)}
      </div>
    </div>
  );
}

function ProjectSlot(props: SubProps) {
  const name = () => (props.node.layout as SlotLayout).name;
  return <>{props.slots[name()]?.(props.node as Measured<SlotLayout>) ?? null}</>;
}

function ProjectLeaf(props: SubProps) {
  return <>{props.renderLeaf(props.node) ?? null}</>;
}

// ── Dispatch table ────────────────────────────────────────────────────────────

const RENDERERS: Record<string, (p: SubProps) => JSX.Element> = {
  stack: ProjectStack,
  pad: ProjectPad,
  bubble: ProjectBubble,
  collapsible: ProjectCollapsible,
  window: ProjectWindow,
  slot: ProjectSlot,
};

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
 * A single `createMemo` over `layout.kind` feeds `<Dynamic component={comp()}>`,
 * replacing a `<Switch>+6<Match>` structure.  This cuts per-node reactive
 * overhead from ~7 constructs to 1 memo + 1 Dynamic, while keeping full
 * reactivity when `kind` changes across re-measures.
 */
export function Project(props: ProjectProps): JSX.Element {
  const slots = props.slots ?? {};
  const renderLeaf = props.children ?? renderBlockLeaf;

  // oxlint-disable-next-line typescript/no-explicit-any -- tree walk; each branch narrows the type
  const renderChild = (child: Measured<any>): JSX.Element => (
    <Project node={child} slots={slots}>
      {renderLeaf}
    </Project>
  );

  const layout = () => props.node.layout as AnyLayout;
  const comp = createMemo(() => RENDERERS[layout().kind] ?? ProjectLeaf);

  return (
    <Dynamic
      component={comp()}
      node={props.node}
      slots={slots}
      render={renderChild}
      renderLeaf={renderLeaf}
    />
  );
}
