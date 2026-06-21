/**
 * BlockStackView — renders a pre-measured Measured<StackLayout> block stack.
 *
 * Replaces the `<Project node={stack}>{renderBlockLeaf}</Project>` pattern
 * used by PlanList and ThinkingUnitRender. Walks the StackLayout directly and
 * dispatches each placed child to the appropriate leaf renderer (Prose/Code/Table).
 *
 * Matches the geometry produced by `layoutBlockStack`: each placed child is
 * absolutely positioned at its `top` offset within the outer div.
 */

import { For } from 'solid-js';
import type { StackLayout } from '../../core/compose';
import type { Measured } from '../../core/define';
import type {
  BlockLeafLayout,
  CodeLeafLayout,
  ProseLeafLayout,
  TableLeafLayout,
} from '../../core/layout/layout-types';
import { Code } from '../rows/markdown/code/Code';
import { Prose } from '../rows/markdown/prose/Prose';
import { Table } from '../rows/markdown/table/Table';

function BlockLeafRender(props: { node: Measured<BlockLeafLayout> }) {
  const layout = props.node.layout;
  if (layout.kind === 'prose') {
    const l = layout as ProseLeafLayout;
    return <Prose block={l} runs={l.raw.runs} variant={l.raw.variant} />;
  }
  if (layout.kind === 'code') {
    const l = layout as CodeLeafLayout;
    return <Code block={l} rawBlock={l.raw} />;
  }
  if (layout.kind === 'table') {
    const l = layout as TableLeafLayout;
    return <Table block={l} />;
  }
  return null;
}

export type BlockStackViewProps = {
  node: Measured<StackLayout>;
};

export function BlockStackView(props: BlockStackViewProps) {
  const placed = () => props.node.layout.placed;
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
            <BlockLeafRender node={p.child as Measured<BlockLeafLayout>} />
          </div>
        )}
      </For>
    </div>
  );
}
