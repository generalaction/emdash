/**
 * Island — Solid component rendering an IslandLaidOut block.
 *
 * Renders a fallback (table/rule/image/pre) and fires onMeasured after mount
 * so the virtualizer can correct the initial height estimate.
 */

import { onMount } from 'solid-js';
import type { IslandLaidOut } from '../../core/layout/layout-types';
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
            {header.map((cell) => (
              <th>{cell}</th>
            ))}
          </tr>
        </thead>
      )}
      {body.length > 0 && (
        <tbody>
          {body.map((row) => (
            <tr>
              {row.map((cell) => (
                <td>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  );
}

export function Island(props: IslandProps) {
  let wrapperEl!: HTMLDivElement;

  onMount(() => {
    if (!props.onMeasured) return;
    requestAnimationFrame(() => {
      const h = wrapperEl?.getBoundingClientRect().height ?? 0;
      if (h > 0) props.onMeasured!(props.block.id, h);
    });
  });

  const inner = () => {
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
  };

  return (
    <div
      ref={wrapperEl}
      class={`${styles.pblock} ${styles.pisland}`}
      style={{
        top: `${props.block.top}px`,
        left: '0',
        right: '0',
      }}
    >
      {inner()}
    </div>
  );
}
