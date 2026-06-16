/**
 * Island — Solid component rendering an IslandLaidOut block.
 *
 * Renders a fallback (rule/image/pre) and fires onMeasured after mount
 * so the virtualizer can correct the initial height estimate.
 *
 * Tables are no longer handled here; they are first-class TableBlock / TableLaidOut
 * rendered by components/table/Table.tsx with formula-based height measurement.
 *
 * Positioning and DOM measurement are handled by MeasuredBlockFrame.
 */

import type { IslandLaidOut } from '../../core/layout/layout-types';
import { MeasuredBlockFrame } from '../block-frame';
import styles from './island.module.css';

export type IslandProps = {
  block: IslandLaidOut;
  onMeasured?: (blockId: string, height: number) => void;
};

function IslandContent(props: { block: IslandLaidOut }) {
  switch (props.block.islandType) {
    case 'rule':
      return (
        <hr
          style={{
            border: 'none',
            'border-top': '1px solid var(--chat-border, #e2e8f0)',
            margin: '0',
          }}
        />
      );
    case 'image':
      return <img src={props.block.raw} alt="" style={{ 'max-width': '100%' }} />;
    default:
      return (
        <div class={styles['pisland--fixed']}>
          <pre style={{ margin: '0', padding: '8px' }}>{props.block.raw}</pre>
        </div>
      );
  }
}

export function Island(props: IslandProps) {
  const handleMeasured = props.onMeasured
    ? (id: string, h: number) => props.onMeasured!(id, h)
    : undefined;

  if (!handleMeasured) {
    return (
      <MeasuredBlockFrame
        layout={props.block}
        id={props.block.id}
        class={styles.pisland}
        onMeasured={() => {}}
      >
        <IslandContent block={props.block} />
      </MeasuredBlockFrame>
    );
  }

  return (
    <MeasuredBlockFrame
      layout={props.block}
      id={props.block.id}
      class={styles.pisland}
      onMeasured={handleMeasured}
    >
      <IslandContent block={props.block} />
    </MeasuredBlockFrame>
  );
}
