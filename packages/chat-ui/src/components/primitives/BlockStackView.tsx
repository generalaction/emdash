import { BLOCK_REGISTRY } from '@components/rows/markdown/block-registry';
import type { StackLayout } from '@core/compose';
import type { Measured } from '@core/define';
import type { BlockLeafLayout } from '@core/layout/layout-types';
import { For, Show, createMemo } from 'solid-js';
import { Dynamic } from 'solid-js/web';

function BlockLeafRender(props: { node: Measured<BlockLeafLayout> }) {
  // Reactive registry lookup: a growing tail block can change KIND across
  // streaming chunks (e.g. a paragraph turning into a code fence) while
  // keeping its id — Dynamic swaps the leaf component when that happens.
  const def = () => BLOCK_REGISTRY[props.node.layout.kind];
  return (
    <Show when={def()}>
      {/* oxlint-disable-next-line typescript/no-explicit-any -- registry boundary */}
      {(d) => <Dynamic component={d().Render} node={props.node as any} />}
    </Show>
  );
}

export type BlockStackViewProps = {
  node: Measured<StackLayout>;
};

export function BlockStackView(props: BlockStackViewProps) {
  const placed = () => props.node.layout.placed;

  /*
   * Key rows by stable block id, not by placed[] wrapper reference. stack()
   * rebuilds placed[] with fresh wrappers on every layout pass, but block ids
   * are stable across streaming chunks, so <For> keeps the DOM of settled
   * blocks alive and only the growing tail (whose Measured child actually
   * changed) re-renders. Leaf defs read `props.node` reactively (no setup-time
   * layout snapshots), which is what makes row persistence safe — a previous
   * persistent-row attempt without reactive leaf reads left growing blocks
   * frozen at their first layout.
   */
  const byId = createMemo(() => {
    const map = new Map<string, { top: number; child: Measured }>();
    for (const p of placed()) map.set(p.id, p);
    return map;
  });
  const ids = () => placed().map((p) => p.id);

  return (
    <div style={{ position: 'relative', height: `${props.node.height}px`, width: '100%' }}>
      <For each={ids()}>
        {(id) => {
          // Split the placed-entry read into separately equality-gated memos:
          // placed[] wrappers are fresh objects every pass, but a settled
          // block's Measured child is identity-stable (blockMemo). Gating the
          // child on identity keeps leaf effects (e.g. Code's token re-apply)
          // from re-running when only OTHER blocks in the stack changed.
          const child = createMemo(() => byId().get(id)?.child);
          const top = createMemo(() => byId().get(id)?.top ?? 0);
          return (
            <Show when={child()}>
              {(c) => (
                <div
                  style={{
                    position: 'absolute',
                    top: `${top()}px`,
                    left: 0,
                    right: 0,
                    height: `${c().height}px`,
                  }}
                >
                  <BlockLeafRender node={c() as Measured<BlockLeafLayout>} />
                </div>
              )}
            </Show>
          );
        }}
      </For>
    </div>
  );
}
