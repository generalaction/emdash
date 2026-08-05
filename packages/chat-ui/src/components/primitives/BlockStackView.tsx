import { BLOCK_REGISTRY } from '@components/rows/markdown/block-registry';
import type { StackLayout } from '@core/compose';
import type { Measured } from '@core/define';
import type { BlockLeafLayout } from '@core/layout/layout-types';
import { Index, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

function BlockLeafRender(props: { node: Measured<BlockLeafLayout> }) {
  const render = () => BLOCK_REGISTRY[props.node.layout.kind]?.Render;
  return (
    <Show when={render()}>
      {(component) => (
        // oxlint-disable-next-line typescript/no-explicit-any -- registry boundary
        <Dynamic component={component()} node={props.node as any} />
      )}
    </Show>
  );
}

export type BlockStackViewProps = {
  node: Measured<StackLayout>;
};

export function BlockStackView(props: BlockStackViewProps) {
  const placed = () => props.node.layout.placed;
  return (
    <div
      style={{
        position: 'relative',
        display: 'flow-root',
        height: `${props.node.height}px`,
        width: '100%',
      }}
    >
      <Index each={placed()}>
        {(p, index) => {
          const previous = () => placed()[index - 1];
          const previousBottom = () => {
            const value = previous();
            return value ? value.top + value.child.height : 0;
          };
          return (
            <div
              style={{
                'margin-top': `${p().top - previousBottom()}px`,
                height: `${p().child.height}px`,
              }}
            >
              <BlockLeafRender node={p().child as Measured<BlockLeafLayout>} />
            </div>
          );
        }}
      </Index>
    </div>
  );
}
