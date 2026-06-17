/**
 * Tool — minimal single-row renderer for generic ChatToolCall items.
 *
 * Used as the desktop fallback for ACP tool kinds without a dedicated renderer
 * (search, fetch, think, other). Consistent with the file-op / execute style:
 * a plain text row with no status badge, no collapse, no detail view.
 *
 * Shimmer applied while status === 'running'. No error-specific chrome.
 */

import { Show } from 'solid-js';
import type { ChatToolCall } from '../../model';
import styles from './tool.module.css';

export type ToolProps = {
  item: ChatToolCall;
};

export function Tool(props: ToolProps) {
  return (
    <div
      class={`${styles['pchat-tool']} flex items-center gap-1.5 text-sm text-foreground-muted select-none`}
      classList={{ 'text-shimmer': props.item.status === 'running' }}
    >
      <span class="text-foreground">{props.item.name}</span>
      <Show when={props.item.inputSummary}>
        <span class="overflow-hidden text-ellipsis whitespace-nowrap opacity-75">
          {props.item.inputSummary}
        </span>
      </Show>
    </div>
  );
}
