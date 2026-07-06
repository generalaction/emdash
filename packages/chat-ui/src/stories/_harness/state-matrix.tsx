/**
 * ToolStateMatrix — stacks labelled rows for each tool status in a single
 * ChatHost, driven by a `build(status) => ChatItem` callback.
 *
 * Currently renders: Running, Awaiting Permission, Done, Error.
 */

import { DEFAULT_THEME } from '@core/theme';
import { For, onCleanup } from 'solid-js';
import { createChatContext } from '@/chat-context';
import { ChatRoot } from '@/ChatRoot';
import type { ChatItem, ToolStatus, TranscriptTurn } from '@/model';
import { createChatState } from '@/state/chat-state';
import { storyViewport } from './chat-host.css';

export type MatrixStatus = ToolStatus;

export type MatrixRow = {
  label: string;
  status: MatrixStatus;
  awaitingPermission?: boolean;
  error?: string;
};

/** Default rows displayed in the matrix. */
const DEFAULT_MATRIX_ROWS: MatrixRow[] = [
  { label: 'Running', status: 'running' },
  { label: 'Awaiting Permission', status: 'running', awaitingPermission: true },
  { label: 'Done', status: 'done' },
  { label: 'Error', status: 'error', error: 'Command failed with exit code 1' },
];

export type ToolStateMatrixProps = {
  /**
   * Build a ChatItem for a given status. The item id must be unique — use a
   * suffix derived from status (e.g. `\`${base}-${status}\``) so each row is
   * independent in the virtualizer.
   */
  build: (status: MatrixStatus) => ChatItem;
  rows?: MatrixRow[];
  /** Height of each individual row viewport in px (default: 80). */
  rowHeight?: number;
  /** Width of the viewport in px (default: 880). */
  width?: number;
};

/**
 * Renders one labeled ChatHost viewport per status row so all states are
 * visible side-by-side in the Storybook canvas.
 */
export function ToolStateMatrix(props: ToolStateMatrixProps) {
  const rows = props.rows ?? DEFAULT_MATRIX_ROWS;
  const rowHeight = props.rowHeight ?? 80;
  const width = props.width ?? 880;

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '12px' }}>
      <For each={rows}>
        {(row) => {
          const ctx = createChatContext({ theme: DEFAULT_THEME });
          const state = createChatState(ctx);
          onCleanup(() => {
            state.dispose();
            ctx.dispose();
          });
          const item = props.build(row.status);
          const matrixItem = {
            ...item,
            ...(row.awaitingPermission ? { awaitingPermission: true } : {}),
            ...(row.error && !('error' in item && item.error) ? { error: row.error } : {}),
          } as ChatItem;
          state.transcript.history.seed([
            {
              id: `matrix-turn-${row.label.toLowerCase().replaceAll(' ', '-')}`,
              seq: 0,
              initiator: 'agent',
              items: [{ ...matrixItem, seq: 0 } as TranscriptTurn['items'][number]],
            },
          ]);
          return (
            <div>
              <div
                style={{
                  'font-size': '11px',
                  'font-family': 'monospace',
                  color: '#888',
                  'margin-bottom': '4px',
                  'padding-left': '4px',
                }}
              >
                {row.label}
              </div>
              <div class={storyViewport} style={{ width: `${width}px`, height: `${rowHeight}px` }}>
                <ChatRoot context={ctx} state={state} stickToBottom pinUserMessages />
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
