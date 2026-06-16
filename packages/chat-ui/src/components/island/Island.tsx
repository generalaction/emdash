/**
 * Island — Solid component rendering an IslandLaidOut block.
 *
 * Renders a fallback (table/rule/image/pre) and fires onMeasured after mount
 * so the virtualizer can correct the initial height estimate.
 *
 * Positioning and DOM measurement are handled by MeasuredBlockFrame.
 */

import { For } from 'solid-js';
import type { IslandLaidOut } from '../../core/layout/layout-types';
import { MeasuredBlockFrame } from '../block-frame';
import styles from './island.module.css';

export type IslandProps = {
  block: IslandLaidOut;
  onMeasured?: (blockId: string, height: number) => void;
};

function TableFallback(props: { raw: string }) {
  const rows = props.raw
    .split('\n')
    .filter((r) => r.trim() && !/^[-| ]+$/.test(r))
    .map((r) =>
      r
        .split('|')
        .map((c) => c.trim())
        .filter((c) => c !== '')
    );
  const [header, ...body] = rows;
  return (
    <table class={styles['pchat-table']}>
      {header && header.length > 0 && (
        <thead>
          <tr>
            <For each={header}>{(cell) => <th>{cell}</th>}</For>
          </tr>
        </thead>
      )}
      {body.length > 0 && (
        <tbody>
          <For each={body}>
            {(row) => (
              <tr>
                <For each={row}>{(cell) => <td>{cell}</td>}</For>
              </tr>
            )}
          </For>
        </tbody>
      )}
    </table>
  );
}

function IslandContent(props: { block: IslandLaidOut }) {
  switch (props.block.islandType) {
    case 'table':
      return <TableFallback raw={props.block.raw} />;
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
