/**
 * Table — Solid component rendering a TableLaidOut block.
 *
 * Uses BlockFrame (not MeasuredBlockFrame) because the height is fully
 * determined by the formula in layoutTable — no DOM write-back needed.
 *
 * Column widths are enforced via <colgroup> + table-layout:fixed so that
 * text-overflow:ellipsis truncation works on every cell. Wide tables (where
 * tableWidth > contentWidth) scroll horizontally inside the scroll wrapper.
 *
 * Each cell receives a native `title` attribute so the full content is
 * accessible on hover via the browser tooltip.
 *
 * Visual styles (overflow, border-color, header bg, truncation) use Tailwind.
 * Geometry-coupled rules (cell padding, font-size, line-height) remain in
 * table.module.css because they define TABLE_ROW_H = 32, which the layout
 * engine and a parity test both enforce.
 */

import { For } from 'solid-js';
import type { TableLaidOut } from '../../core/layout/layout-types';
import { BlockFrame } from '../block-frame';
import styles from './table.module.css';

export type TableProps = {
  block: TableLaidOut;
};

export function Table(props: TableProps) {
  return (
    <BlockFrame layout={props.block} class="overflow-x-auto">
      <table
        class={styles['pchat-table']}
        style={{ width: `${props.block.tableWidth}px`, 'table-layout': 'fixed' }}
      >
        <colgroup>
          <For each={props.block.colWidths}>{(w) => <col style={{ width: `${w}px` }} />}</For>
        </colgroup>
        <thead>
          <tr>
            <For each={props.block.header}>
              {(cell) => (
                <th
                  class="overflow-hidden border border-border bg-background-1 text-ellipsis whitespace-nowrap"
                  title={cell}
                >
                  {cell}
                </th>
              )}
            </For>
          </tr>
        </thead>
        <tbody>
          <For each={props.block.rows}>
            {(row) => (
              <tr>
                <For each={row}>
                  {(cell) => (
                    <td
                      class="overflow-hidden border border-border text-ellipsis whitespace-nowrap"
                      title={cell}
                    >
                      {cell}
                    </td>
                  )}
                </For>
              </tr>
            )}
          </For>
        </tbody>
      </table>
    </BlockFrame>
  );
}
