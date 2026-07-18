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

import { IconError, IconShieldAlert } from '@components/primitives/icons';
import { Show } from 'solid-js';
import type { ChatToolCall } from '@/model';
import {
  textShimmer,
  toolErrorIcon,
  toolName,
  toolPermissionIcon,
  toolRow,
  toolSummary,
} from './tool.css';

export type ToolProps = {
  item: ChatToolCall;
};

export function Tool(props: ToolProps) {
  const isRunning = () => props.item.status === 'running' && !props.item.awaitingPermission;
  return (
    <div class={toolRow} classList={{ [textShimmer]: isRunning() }}>
      <span class={toolName}>{props.item.name}</span>
      <Show when={props.item.inputSummary}>
        <span class={toolSummary}>{props.item.inputSummary}</span>
      </Show>
      <Show
        when={props.item.awaitingPermission}
        fallback={
          <Show when={props.item.status === 'error'}>
            <span class={toolErrorIcon} title={props.item.error ?? 'Failed'} aria-label="error">
              <IconError />
            </span>
          </Show>
        }
      >
        <span
          class={toolPermissionIcon}
          title="Awaiting permission"
          aria-label="awaiting permission"
        >
          <IconShieldAlert />
        </span>
      </Show>
    </div>
  );
}
