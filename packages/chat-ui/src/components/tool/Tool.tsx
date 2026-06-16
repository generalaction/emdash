/**
 * Tool — Solid component rendering a ChatToolCall row.
 *
 * Collapse toggle uses data-collapse-id so the root's click delegation handles it.
 *
 * Visual styles use Tailwind utilities. Geometry-coupled rules (row padding,
 * font-size) remain in tool.module.css because measureTool() depends on them.
 */

import { Show } from 'solid-js';
import type { ChatToolCall, ToolStatus } from '../../model';
import styles from './tool.module.css';

const STATUS_ICON: Record<ToolStatus, string> = {
  running: '⋯',
  done: '✓',
  error: '✕',
};

const STATUS_COLOR: Record<ToolStatus, string> = {
  running: 'text-foreground-muted border-foreground-muted',
  done: 'text-[#16a34a] border-[#16a34a]',
  error: 'text-[var(--foreground-destructive,#dc2626)] border-[var(--foreground-destructive,#dc2626)]',
};

export type ToolProps = {
  item: ChatToolCall;
  collapsed?: boolean;
};

export function Tool(props: ToolProps) {
  return (
    <div class={`${styles['pchat-tool']} flex items-center gap-2 font-mono text-foreground-muted`}>
      <span
        class={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border text-[10px] ${STATUS_COLOR[props.item.status] ?? ''}`}
        aria-label={props.item.status}
      >
        {STATUS_ICON[props.item.status] ?? '?'}
      </span>
      <span class="font-medium text-foreground">{props.item.name}</span>
      <Show when={props.item.inputSummary}>
        <span class="overflow-hidden text-ellipsis whitespace-nowrap opacity-75">
          {props.item.inputSummary}
        </span>
      </Show>
      <Show when={props.item.detail}>
        {(detail) => (
          <>
            <button
              type="button"
              class="ml-auto cursor-pointer border-none bg-none p-[0_4px] font-mono text-[11px] text-foreground-muted hover:text-foreground"
              aria-expanded={!props.collapsed ? 'true' : 'false'}
              data-collapse-id={props.item.id}
            >
              {props.collapsed ? '▸ detail' : '▾ detail'}
            </button>
            <Show when={!props.collapsed}>
              <div class={`${styles['pchat-tool__detail']} font-mono text-foreground-muted`}>
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
