/**
 * Project — generic layout tree renderer.
 *
 * Walks a `Measured` tree by `layout.kind` and renders each node with full
 * projection (all geometry from the layout, no CSS-driven geometry).
 *
 * Combinator nodes (stack / pad / bubble / collapsible / window) are handled
 * by this component directly. Leaf nodes (prose / code / table / island) are
 * dispatched to the corresponding ComponentDef.Render via REGISTRY.
 *
 * Row-level composite components (message, thinking, file-op) use
 * `layoutBlocks` + `BlockStack` internally and do NOT go through `Project`;
 * `Project` is used by those composites only when they want to compose
 * block-level layouts using the new combinator-based approach.
 *
 * Currently `Project` handles the block-level stack / pad / bubble layouts
 * that composites construct via the compose.ts combinators. The existing
 * BlockStack.tsx remains in use for backward-compatible rendering inside
 * Message.tsx and Thinking.tsx.
 */

import { For, Show, type JSX } from 'solid-js';
import type {
  StackLayout,
  PadLayout,
  BubbleLayout,
  CollapsibleLayout,
  WindowLayout,
} from '../core/compose';
import type { Measured } from '../core/define';

// ── Type discriminator ────────────────────────────────────────────────────────

type AnyLayout = { kind: string };

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
  const { padX, child } = props.node.layout;
  return (
    <div
      style={{
        position: 'relative',
        height: `${props.node.height}px`,
        'padding-left': `${padX}px`,
        'padding-right': `${padX}px`,
      }}
    >
      {props.render(child)}
    </div>
  );
}

function ProjectCollapsible(props: {
  node: Measured<CollapsibleLayout>;
  renderHeader: () => JSX.Element;
  render: (child: Measured) => JSX.Element;
}) {
  const { headerH, bodyTop, expanded, child } = props.node.layout;
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px` }}>
      <div style={{ position: 'absolute', top: '0', left: 0, right: 0, height: `${headerH}px` }}>
        {props.renderHeader()}
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
  const { maxH, child } = props.node.layout;
  return (
    <div
      style={{
        height: `${props.node.height}px`,
        'max-height': `${maxH}px`,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {props.render(child)}
    </div>
  );
}

// ── Main dispatcher ───────────────────────────────────────────────────────────

export type ProjectProps = {
  node: Measured<AnyLayout>;
  children?: (child: Measured) => JSX.Element;
};

/**
 * Render a `Measured` layout tree by `layout.kind`.
 *
 * Combinator nodes (stack / pad / bubble / collapsible / window) are rendered
 * recursively.  All other kinds are treated as leaves and rendered via the
 * `children` slot (which the caller provides from their own REGISTRY lookup).
 *
 * If `children` is not provided, leaf nodes render nothing — callers must
 * supply a `children` render prop for any leaf kinds they want to display.
 */
export function Project(props: ProjectProps): JSX.Element {
  const layout = props.node.layout as AnyLayout;
  const renderChild = (child: Measured): JSX.Element =>
    props.children ? props.children(child) : null;

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
          renderHeader={() => null}
          render={renderChild}
        />
      );
    case 'window':
      return <ProjectWindow node={props.node as Measured<WindowLayout>} render={renderChild} />;
    default:
      return renderChild(props.node) ?? null;
  }
}
