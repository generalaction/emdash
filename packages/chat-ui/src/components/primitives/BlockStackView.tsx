import { Key } from '@solid-primitives/keyed';
import { BLOCK_REGISTRY } from '@components/rows/markdown/block-registry';
import type { StackLayout } from '@core/compose';
import type { Measured } from '@core/define';
import type { BlockLeafLayout } from '@core/layout/layout-types';
import { Dynamic } from 'solid-js/web';

function BlockLeafRender(props: { node: Measured<BlockLeafLayout> }) {
  const def = BLOCK_REGISTRY[props.node.layout.kind];
  if (!def) return null;
  // oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
  return <Dynamic component={def.Render} node={props.node as any} />;
}

export type BlockStackViewProps = {
  node: Measured<StackLayout>;
};

export function BlockStackView(props: BlockStackViewProps) {
  const placed = () => props.node.layout.placed;
  return (
    <div style={{ position: 'relative', height: `${props.node.height}px`, width: '100%' }}>
      {/*
       * Key by block id rather than by reference so settled block rows persist
       * across streaming chunks. stack() rebuilds placed[] with new wrapper
       * objects every layout pass, but block ids are stable (${messageId}#${index}),
       * so Key reuses the row instance for unchanged settled blocks. The render
       * callback receives an accessor p() so growing rows stay reactive, while
       * settled rows receive a stable node reference and their highlight effect
       * runs exactly once.
       */}
      <Key each={placed()} by="id">
        {(p) => (
          <div
            style={{
              position: 'absolute',
              top: `${p().top}px`,
              left: 0,
              right: 0,
              height: `${p().child.height}px`,
            }}
          >
            <BlockLeafRender node={p().child as Measured<BlockLeafLayout>} />
          </div>
        )}
      </Key>
    </div>
  );
}
