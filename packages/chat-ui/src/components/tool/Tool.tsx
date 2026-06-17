/**
 * Tool — minimal single-row renderer for generic ChatToolCall items.
 *
 * Used as the desktop fallback for ACP tool kinds without a dedicated renderer
 * (search, fetch, think, other). Consistent with the file-op / execute style:
 * a plain text row with no status badge, no collapse, no detail view.
 *
 * Shimmer applied while status === 'running'. No error-specific chrome.
 *
 * Outer geometry (height, padding) is applied by tool.def.ts Render.
 * This component only describes inner content.
 */

import { Show } from 'solid-js';
import type { ChatToolCall } from '../../model';

export type ToolProps = {
  item: ChatToolCall;
};

export function Tool(props: ToolProps) {
  return (
    <div
      class="flex items-center gap-1.5 text-sm text-foreground-passive select-none"
      classList={{ 'text-shimmer': props.item.status === 'running' }}
    >
      <span>{props.item.name}</span>
      <Show when={props.item.inputSummary}>
        <span class="overflow-hidden text-ellipsis whitespace-nowrap opacity-75">
          {props.item.inputSummary}
        </span>
      </Show>
    </div>
  );
}
