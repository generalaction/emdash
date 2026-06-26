/**
 * ToolStateMatrix — stacks labelled rows for each tool status in a single
 * ChatHost, driven by a `build(status) => ChatItem` callback.
 *
 * Currently renders: Running, Done, Error.
 * Designed to accept Pending/Permission rows later as config-only additions.
 */

import { DEFAULT_THEME } from '@core/theme';
import { createTranscript } from '@state/transcript';
import { createViewState } from '@state/view-state';
import { For } from 'solid-js';
import { ChatRoot } from '@/ChatRoot';
import type { ChatItem, ToolStatus } from '@/model';
import { storyViewport } from './chat-host.css';

export type MatrixStatus = ToolStatus;

export type MatrixRow = {
  label: string;
  status: MatrixStatus;
};

/** Default rows displayed in the matrix. */
const DEFAULT_MATRIX_ROWS: MatrixRow[] = [
  { label: 'Running', status: 'running' },
  { label: 'Done', status: 'done' },
  { label: 'Error', status: 'error' },
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
          const transcript = createTranscript();
          const viewState = createViewState();
          transcript.history.seed([props.build(row.status)]);
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
                <ChatRoot
                  transcript={transcript}
                  viewState={viewState}
                  theme={DEFAULT_THEME}
                  stickToBottom
                  pinUserMessages
                />
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
}
