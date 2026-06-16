/**
 * Tool — Solid component rendering a ChatToolCall row.
 *
 * Collapse toggle uses data-collapse-id so the root's click delegation handles it.
 */

import { Show } from 'solid-js';
import type { ChatToolCall, ToolStatus } from '../../model';
import styles from './tool.module.css';

const STATUS_ICON: Record<ToolStatus, string> = {
  running: '⋯',
  done: '✓',
  error: '✕',
};

export type ToolProps = {
  item: ChatToolCall;
  collapsed?: boolean;
};

export function Tool(props: ToolProps) {
  return (
    <div class={styles['pchat-tool']}>
      <span
        class={`${styles['pchat-tool__badge']} ${styles[`pchat-tool__badge--${props.item.status}`]}`}
        aria-label={props.item.status}
      >
        {STATUS_ICON[props.item.status] ?? '?'}
      </span>
      <span class={styles['pchat-tool__name']}>{props.item.name}</span>
      <Show when={props.item.inputSummary}>
        <span class={styles['pchat-tool__summary']}>{props.item.inputSummary}</span>
      </Show>
      <Show when={props.item.detail}>
        {(detail) => (
          <>
            <button
              type="button"
              class={styles['pchat-collapse-toggle']}
              aria-expanded={!props.collapsed ? 'true' : 'false'}
              data-collapse-id={props.item.id}
            >
              {props.collapsed ? '▸ detail' : '▾ detail'}
            </button>
            <Show when={!props.collapsed}>
              <div class={styles['pchat-tool__detail']}>
                <pre style={{ margin: '0', 'font-size': '11px', 'white-space': 'pre-wrap' }}>
                  {detail()}
                </pre>
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
}
